import { config } from './config.js';
import { criarApp } from './app.js';
import { migrar } from './db/migrate.js';
import { seedAdmin } from './db/seed.js';
import { processarViradas } from './modules/cartoes.service.js';

async function main() {
  await migrar();
  await seedAdmin();
  const app = await criarApp({ logger: true });
  await app.listen({ port: config.port, host: '0.0.0.0' });

  // Virada automática dos cartões (RF-CAR-06): na subida e depois periodicamente.
  const rodar = async () => {
    try {
      const r = await processarViradas();
      if (r.processadas || r.falhas.length) app.log.info({ virada: r }, 'virada de cartões processada');
    } catch (e) {
      app.log.error(e, 'falha na rotina de virada');
    }
  };
  await rodar();
  setInterval(rodar, config.viradaIntervaloMs);
}

main().catch((e) => { console.error(e); process.exit(1); });
