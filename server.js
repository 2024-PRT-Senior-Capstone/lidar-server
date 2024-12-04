const express = require('express');
const { SerialPort } = require('serialport');
const cors = require('cors');

const app = express();
const port = 3001;
app.use(cors());

// Serial connection to the LD20 LIDAR on COM3
const serialPort = new SerialPort({ path: '/dev/ttyUSB0', baudRate: 230400 });

// Buffer to accumulate incoming data
let incomingBuffer = Buffer.alloc(0);

// Array to store the history of recent packets
const history = [];
const MAX_HISTORY_SIZE = 100; // Limit the history size to 100 packets

//The vars below need to be adjusted based on door angle/distance
const MIN_LIDAR_ANGLE = 170; 
const MAX_LIDAR_ANGLE = 201;
const FLOOR_DISTANCE = 600;
const DOOR_DISTANCE = 215;
const TOLERANCE = 5;


var isDoorOpen = false;
var sawSomething = false;
var occupancy = 0;
var closedCount = 0;
var sawFloor = false;
var lastPersonAngle = 0;
var sawFloorCount = 0;
var timeElapsed = 0;
var didDecrement = false;
var didClose = false;
var cycleToClose = 0;


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
		
		if(parsedData.start_angle >= MIN_LIDAR_ANGLE && parsedData.start_angle <= MAX_LIDAR_ANGLE && parsedData.end_angle >= MIN_LIDAR_ANGLE && parsedData.end_angle <= MAX_LIDAR_ANGLE){

			// if(isDoorOpen){
			// 	// Start a timer when the door is open
			// 		setTimeout(() => {
			// 			// Assume the door should be closed by now
			// 			isDoorOpen = false;
			// 		}, 60000); // 1 minute
			// }
			
			//Debug statements
			//console.log("distance: " + parsedData.points[6].distance)
			//console.log("saw floor: " + sawFloor)
			//console.log(" ")

		
			//if all points report door distance then door is closed or someone is standing there
			if (points.every(point => point.distance <= DOOR_DISTANCE)) {
			
				closedCount++;

				//After 5 consecutive potential door closings set door status to closed.
				if(closedCount > 50){
					console.log("door closed" + closedCount)
					// didClose = true;
					isDoorOpen = false; 
					// if(!didDecrement){
					// 	didDecrement = true
					// 	//occupancy--
					// }
				}

				//Otherwise something else is in front of the door like a person
				else{
					sawFloorCount = 0;
					//If we have seen the floor before and now we see something else we can assume a person is going through the door
					if(sawFloor){
						occupancy++
						sawFloor = false
					}
				}
				
				
			}

			//case where door is open because we see the floor 
			else if (points.every(point => point.distance <= FLOOR_DISTANCE& point.distance >= DOOR_DISTANCE)) {

				// Set door open
				isDoorOpen = true; 
				didDecrement = false;

				//Reset the closed count to 0 if all points report the floor
				if(didClose){
					occupancy = 0;
					didClose = true;
				}
				closedCount = 0;

				//If all points report the floor set saw floor to true
				sawFloorCount++;

				//After 5 potential full floor reports we can be sure we have seen the floor. 
				if(sawFloorCount > 5){
					//Set saw floor bool to true
					sawFloor = true;
					//Reset saw floor count
					sawFloorCount = 0;
				}
				
			}
			
			else{
				console.log("nothing") //Not sure what would result in the nothing case 
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

//Endpoint to serve door status
app.get('/api/door-status', (req, res) => {
	res.json(isDoorOpen);
})

//Endpoint to serve occupancy
app.get('/api/occupancy', (req, res) => {
	res.json(occupancy);
})

// Start the server
app.listen(port, () => {
	console.log(`Listening at http://localhost:${port}`);
});


