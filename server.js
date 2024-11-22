const express = require('express');
const { SerialPort } = require('serialport');
const cors = require('cors');

const app = express();
const port = 3001;
app.use(cors());

// Serial connection to the LD20 LIDAR on COM3
const serialPort = new SerialPort({ path: 'COM5', baudRate: 230400 });

// Buffer to accumulate incoming data
let incomingBuffer = Buffer.alloc(0);

// Array to store the history of recent packets
const history = [];
const MAX_HISTORY_SIZE = 100; // Limit the history size to 100 packets

serialPort.on('data', (data) => {
	// Append new data to buffer
	incomingBuffer = Buffer.concat([incomingBuffer, data]);

	// Loop to process multiple packets in the buffer, if present
	while (incomingBuffer.length >= 47) {
		// Look for the header byte 0x54 to find the start of a packet
		const headerIndex = incomingBuffer.indexOf(0x54);

		if (headerIndex === -1) {
			// No header found, clear the buffer (data might be noise or incomplete)
			incomingBuffer = Buffer.alloc(0);
			return;
		}

		// Check if there is enough data after the header for a full packet
		if (incomingBuffer.length - headerIndex < 47) {
			// Not enough data for a full packet, wait for more data
			break;
		}

		// Extract a full 47-byte packet from the header position
		const packet = incomingBuffer.slice(headerIndex, headerIndex + 47);

		// Parse the packet fields
		const ver_len = packet[1];
		const speed = packet.readUInt16LE(2);
		const start_angle = packet.readUInt16LE(4) / 100;

		// Parse measurement points
		const points = [];
		for (let i = 0; i < 12; i++) {
			const distance = packet.readUInt16LE(6 + i * 3);
			const intensity = packet[8 + i * 3];
			points.push({ distance, intensity });
		}

		const end_angle = packet.readUInt16LE(42) / 100;
		const timestamp = packet.readUInt16LE(44);
		const crc8 = packet[46];

		// Construct packet data
		const parsedData = {
			version: ver_len,
			speed,
			start_angle,
			points,
			end_angle,
			timestamp,
			crc8,
		};

		// Add parsed packet data to history
		history.push(parsedData);
		
		if(parsedData.start_angle > 40 && parsedData.start_angle < 60){
		
			if(parsedData.points[0].distance < 100){
				console.log("Door Closed")
			}
			else{
				console.log("Door Open")
			}
		}

		// Ensure history doesn't exceed the maximum size
		if (history.length > MAX_HISTORY_SIZE) {
			history.shift(); // Remove the oldest packet when limit is exceeded
		}

		// Remove processed packet from buffer
		incomingBuffer = incomingBuffer.slice(headerIndex + 47);
	}
});

// Endpoint to serve the history of recent packets
app.get('/api/lidar-data', (req, res) => {
	res.json(history);
});

// Start the server
app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}`);
});

