const { screenShipment } = require('./src/services/fraudScreeningService');

async function run() {
  try {
    const payload = {
      shipment_id: 'SH-VALIDATE-1',
      shipper_id: 'S1001',
      origin: 'Chennai',
      destination: 'Delhi',
      weight: 25.5,
      service_type: 'EXPRESS',
      payment_id: 'P19',
      device_id: 'D88',
      package_count: 2,
      simulate: true
    };
    const res = await screenShipment(payload);
    console.log(res);
  } catch (err) {
    console.error('FAILED:', err);
  } finally {
    process.exit(0);
  }
}
run();
