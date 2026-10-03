const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const generateDemoCsv = (filePath, numRows = 50) => {
  const headers = [
    'shipment_id', 'shipper_id', 'origin', 'destination', 
    'destination_address_id', 'weight', 'service_type', 
    'payment_id', 'device_id', 'package_count', 'booking_timestamp'
  ];

  const origins = ['Mumbai', 'Delhi', 'Bangalore', 'Kolkata', 'Chennai', 'Dubai', 'Kuwait', 'New York'];
  const destinations = ['Pune', 'Hyderabad', 'London', 'Singapore', 'Kabul', 'Azerbaijan', 'Paris'];
  const services = ['STANDARD', 'EXPRESS', 'OVERNIGHT'];

  let csvContent = headers.join(',') + '\n';

  for (let i = 0; i < numRows; i++) {
    // Generate some fraud scenarios and some clean ones
    const isFraud = Math.random() < 0.2; // 20% fraud injection
    
    const row = [
      `SH${uuidv4().substring(0, 8).toUpperCase()}`,
      isFraud ? `S999${i}` : `S100${i % 10}`,
      origins[Math.floor(Math.random() * origins.length)],
      destinations[Math.floor(Math.random() * destinations.length)],
      `ADDR${Math.floor(Math.random() * 1000)}`,
      isFraud ? (100 + Math.random() * 50).toFixed(2) : (1 + Math.random() * 20).toFixed(2), // Fraud has heavy packages
      services[Math.floor(Math.random() * services.length)],
      `PAY${Math.floor(Math.random() * 1000)}`,
      `DEV${Math.floor(Math.random() * 1000)}`,
      isFraud ? Math.floor(1 + Math.random() * 5) : 1,
      new Date(Date.now() - Math.random() * 10000000000).toISOString()
    ];
    csvContent += row.join(',') + '\n';
  }

  fs.writeFileSync(filePath, csvContent);
  console.log(`Generated ${numRows} rows in ${filePath}`);
};

if (require.main === module) {
  const file = process.argv[2] || 'demo_shipments.csv';
  generateDemoCsv(file, 100);
}

module.exports = generateDemoCsv;
