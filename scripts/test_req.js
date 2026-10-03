const axios = require('axios');

async function testReq() {
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
  try {
    const res = await axios.post('http://localhost:3000/api/fraud/screen', payload);
    console.log(res.data);
  } catch (err) {
    if (err.response) {
      console.log('STATUS:', err.response.status);
      console.log('BODY:', err.response.data);
    } else {
      console.log('ERROR:', err.message);
    }
  }
}
testReq();
