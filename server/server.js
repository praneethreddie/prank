const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// roomID -> { host: ws, receiver: ws, offer: sdp }
const rooms = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        const { type, roomId, role, sdp, candidate } = data;

        console.log(`Received ${type} for room ${roomId} from ${role}`);

        switch (type) {
            case 'create':
                // Host creates a room
                rooms.set(roomId, { host: ws, receiver: null, offer: null });
                ws.roomId = roomId;
                ws.role = 'host';
                console.log(`Room ${roomId} created by host`);
                break;

            case 'join':
                // Receiver joins a room
                if (rooms.has(roomId)) {
                    const room = rooms.get(roomId);
                    room.receiver = ws;
                    ws.roomId = roomId;
                    ws.role = 'receiver';
                    console.log(`Receiver joined room ${roomId}`);

                    // If host already sent an offer, send it to the receiver
                    if (room.offer) {
                        ws.send(JSON.stringify({ type: 'offer', sdp: room.offer }));
                    }
                } else {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                }
                break;

            case 'offer':
                // Host sends an offer
                if (rooms.has(roomId)) {
                    const room = rooms.get(roomId);
                    room.offer = sdp;
                    console.log(`Offer stored for room ${roomId}`);
                    // If receiver is already there, forward it
                    if (room.receiver) {
                        room.receiver.send(JSON.stringify({ type: 'offer', sdp }));
                    }
                }
                break;

            case 'answer':
                // Receiver sends an answer
                if (rooms.has(roomId)) {
                    const room = rooms.get(roomId);
                    if (room.host) {
                        room.host.send(JSON.stringify({ type: 'answer', sdp }));
                        console.log(`Answer forwarded to host in room ${roomId}`);
                    }
                }
                break;

            case 'candidate':
                // Relay ICE candidates
                if (rooms.has(roomId)) {
                    const room = rooms.get(roomId);
                    const target = role === 'host' ? room.receiver : room.host;
                    if (target) {
                        target.send(JSON.stringify({ type: 'candidate', candidate }));
                        console.log(`ICE candidate forwarded to ${role === 'host' ? 'receiver' : 'host'}`);
                    }
                }
                break;

            case 'delete':
                // Host manually deletes a room
                if (rooms.has(roomId) && ws.role === 'host') {
                    console.log(`Explicitly deleting room ${roomId}`);
                    const room = rooms.get(roomId);
                    if (room.receiver) {
                        room.receiver.send(JSON.stringify({ type: 'room_deleted' }));
                    }
                    rooms.delete(roomId);
                }
                break;

            default:
                console.warn(`Unknown message type: ${type}`);
        }
    });

    ws.on('close', () => {
        if (ws.roomId && rooms.has(ws.roomId)) {
            const room = rooms.get(ws.roomId);
            if (ws.role === 'host') {
                console.log(`Host disconnected from room ${ws.roomId}. Room remains active for rejoin.`);
                room.host = null;
                // We keep the room so the host can rejoin from the same ID. 
                // In a real prod app, we'd add a timeout here to cleanup.
            } else if (ws.role === 'receiver') {
                console.log(`Receiver disconnected from room ${ws.roomId}`);
                room.receiver = null;
            }
        }
    });
});

server.listen(PORT, () => {
    console.log(`Signaling server running on port ${PORT}`);
});
