const axios = require('axios');

async function validatePipeline() {
  console.log('Validating FraudShield pipeline...');
  
  const payload = {
    shipment_id: `SH-VALIDATE-${Date.now()}`,
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

  try {
    const start = Date.now();
    const res = await axios.post('http://localhost:3000/api/fraud/screen', payload);
    const ms = Date.now() - start;
    
    if (res.data && res.data.risk) {
      console.log(`✅ Pipeline validated successfully in ${ms}ms`);
      console.log(`Risk Score: ${res.data.risk.risk_score}`);
      console.log(`Decision: ${res.data.decision.action}`);
      process.exit(0);
    } else {
      console.error('❌ Pipeline validation failed: Missing assessment in response.');
      process.exit(1);
    }
  } catch (err) {
    if (err.response) {
      console.error('❌ Pipeline validation failed with status', err.response.status);
      console.error(err.response.data);
    } else {
      console.error('❌ Pipeline validation failed:', err.message);
    }
    process.exit(1);
  }
}

validatePipeline();
