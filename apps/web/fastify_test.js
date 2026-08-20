import fastify from 'fastify';
const app = fastify();
app.get('/', (req, reply) => {
  try {
    reply.header('Content-Disposition', `inline; filename="[2] Konsep Data dan Statistika Multivariat.pdf"`);
    reply.send("OK");
  } catch(e) {
    console.error("Fastify error:", e);
    reply.status(500).send(e.message);
  }
});
app.listen({port: 9999}).then(() => console.log('started'));
