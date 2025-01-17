const { Kafka } = require('@confluentinc/kafka-javascript').KafkaJS;
const { SchemaRegistry, SchemaType } = require('@kafkajs/confluent-schema-registry');

const registry = new SchemaRegistry({ host: 'http://schema-registry.schema-registry-nodejs.orb.local:8081' })

const kafka = new Kafka({
  kafkaJS: {
    brokers: ['broker.schema-registry-nodejs.orb.local:9092'],
  }
});
let consumer = kafka.consumer({
  kafkaJS: {
    groupId: "test-group",
    fromBeginning: true,
  },
});
let producer = kafka.producer();

const schemaA = {
  type: 'record',
  namespace: 'test',
  name: 'A',
  fields: [
    { name: 'id', type: 'int' },
    { name: 'b', type: 'test.B' },
  ],
};

const schemaB = {
  type: 'record',
  namespace: 'test',
  name: 'B',
  fields: [{ name: 'id', type: 'int' }],
};

const topicName = 'test-topic';

const run = async () => {
  // Register schemaB.
  await registry.register(
    {
      type: SchemaType.AVRO,
      schema: JSON.stringify(schemaB),
    },
    { subject: 'Avro:B' },
  );
  const response = await registry.api.Subject.latestVersion({ subject: 'Avro:B' });
  const { version } = JSON.parse(response.responseData);

  // Register schemaA, which references schemaB.
  const { id } = await registry.register(
    {
      type: SchemaType.AVRO,
      schema: JSON.stringify(schemaA),
      references: [
        {
          name: 'test.B',
          subject: 'Avro:B',
          version,
        },
      ],
    },
    { subject: 'Avro:A' },
  )

  // Produce a message with schemaA.
  await producer.connect()
  const outgoingMessage = {
    key: 'key',
    value: await registry.encode(id, { id: 1, b: { id: 2 } })
  }
  await producer.send({
    topic: topicName,
    messages: [outgoingMessage]
  });
  console.log("Producer sent its message.")
  await producer.disconnect();
  producer = null;

  await consumer.connect()
  await consumer.subscribe({ topic: topicName })

  let messageRcvd = false;
  await consumer.run({
    eachMessage: async ({ message }) => {
      const decodedMessage = {
        ...message,
        value: await registry.decode(message.value)
      };
      console.log("Consumer recieved message.\nBefore decoding: " + JSON.stringify(message) + "\nAfter decoding: " + JSON.stringify(decodedMessage));
      messageRcvd = true;
    },
  });

  // Wait around until we get a message, and then disconnect.
  while (!messageRcvd) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await consumer.disconnect();
  consumer = null;
}

console.log("Starting run.")
run().catch(async e => {
  console.error(e);
  consumer && await consumer.disconnect();
  producer && await producer.disconnect();
  process.exit(1);
})
