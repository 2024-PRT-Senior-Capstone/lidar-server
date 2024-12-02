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

//The vars below need to be adjusted based on door angle/distance
const MIN_LIDAR_ANGLE = 40; 
const MAX_LIDAR_ANGLE = 60;
const FLOOR_DISTANCE = 100;
const DOOR_DISTANCE = 50;
const TOLERANCE = 5;

var isDoorOpen = false;
var sawSomething = false;
var occupancy = 0;

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
		
		//If the start angle is between 40 and 60 degrees
		if(parsedData.start_angle > MIN_LIDAR_ANGLE && parsedData.end_angle < MAX_LIDAR_ANGLE){

			// Check if all points are in range of floor distance
			if (points.every(point => point.distance >= FLOOR_DISTANCE - TOLERANCE || point.distance <= FLOOR_DISTANCE + TOLERANCE)) {
				isDoorOpen = true; // Set door open

			//Check if all points are in range of the door distance 
			} else if (points.every(point => point.distance >= DOOR_DISTANCE - TOLERANCE || point.distance <= DOOR_DISTANCE + TOLERANCE)) {
				isDoorOpen = false; // Set door closed

			//If the door is open and the middle point is less than the floor distance then we saw something other than the door 
			} else if (isDoorOpen && points[5].distance < FLOOR_DISTANCE) {
				print("saw something")
				//If this is the first time we saw something then we set sawSomething to true
				if(!sawSomething){
					sawSomething = true
				}
			} else if(isDoorOpen && points[5].distance ==  FLOOR_DISTANCE ){
				print("saw floor")
				//If we have seen something and now we see the floor then we saw something move in front of the sensor
				if(sawSomething){
					occupancy++
					sawSomething = false
				}
			} else{
				print("nothing") 
				continue;
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
app.get('/api/door-status', (req, res) => {
	res.json(isDoorOpen);
})

// Start the server
app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}`);
});

