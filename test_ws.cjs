const WebSocket = require('ws');

const API_KEY = "AIzaSyAXaohLTvDEqxi0tTNsCW3RMdAJoFzz3A8";
const WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${API_KEY}`;

const ws = new WebSocket(WS_URL);

let setupComplete = false;
let chunksToSend = ["Hello.", "How are you doing today?", "I hope you are fine."];

ws.on('open', () => {
    console.log("Connected.");

    const setupMsg = {
        setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: "Aoede"
                        }
                    }
                }
            },
            systemInstruction: {
                parts: [{ text: "Read the text." }]
            }
        }
    };
    ws.send(JSON.stringify(setupMsg));
    console.log("Sent setup.");
});

ws.on('message', (data) => {
    let msgStr = data.toString();
    console.log("Received:", msgStr.substring(0, 150) + (msgStr.length > 150 ? "..." : ""));

    let msg = JSON.parse(msgStr);

    if (msg.setupComplete) {
        console.log("Setup complete! Sending first chunk.");
        sendNext();
    }

    if (msg.serverContent && msg.serverContent.turnComplete) {
        console.log("Server finished turn.");
        sendNext();
    }
});

function sendNext() {
    if (chunksToSend.length === 0) {
        console.log("Done sending chunks");
        return;
    }
    let chunk = chunksToSend.shift();
    console.log("Sending chunk:", chunk);

    const clientContentMsg = {
        clientContent: {
            turns: [
                {
                    role: "user",
                    parts: [{ text: chunk }]
                }
            ],
            turnComplete: true
        }
    };
    ws.send(JSON.stringify(clientContentMsg));
}

ws.on('close', (code, reason) => {
    console.log(`Disconnected with code: ${code}, reason: ${reason}`);
});

ws.on('error', (err) => {
    console.error("Error:", err);
});
