const HOST = 'generativelanguage.googleapis.com';
const WS_URL = `wss://${HOST}/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;

// UI Elements
const apiKeyInput = document.getElementById('api-key');
const textInput = document.getElementById('text-input');
const voiceModelSelect = document.getElementById('voice-model');
const emotionSelect = document.getElementById('emotion');
const pacingSelect = document.getElementById('pacing');
const personaSelect = document.getElementById('persona');
const pitchSelect = document.getElementById('pitch');
const audioQualitySelect = document.getElementById('audio-quality');
const autoPlayCheckbox = document.getElementById('auto-play');
const naturalPausesCheckbox = document.getElementById('natural-pauses');

const generateBtn = document.getElementById('generate-btn');
const downloadBtn = document.getElementById('download-btn');
const statusText = document.getElementById('status-text');
const audioContainer = document.getElementById('audio-container');
const audioPlayer = document.getElementById('audio-player');
const loader = document.querySelector('.loader');

// State
let ws = null;
let audioContext = null;
let recordedChunks = [];
let audioQueue = [];
let isPlaying = false;
let currentAudioBlobUrl = null;
let textChunksQueue = [];
let totalChunks = 0;
let currentChunkIndex = 0;

// Initialize
function init() {
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey) {
        apiKeyInput.value = savedKey;
    }
    generateBtn.addEventListener('click', handleGenerate);
    downloadBtn.addEventListener('click', handleDownload);
}

// Ensure audio context is ready (requires user interaction)
function initAudioContext(sampleRate) {
    if (audioContext && audioContext.sampleRate !== sampleRate) {
        audioContext.close();
        audioContext = null;
    }
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: sampleRate });
    }
}

async function handleGenerate() {
    const apiKey = apiKeyInput.value.trim();
    const text = textInput.value.trim();
    const voiceName = voiceModelSelect.value;
    const emotion = emotionSelect.value;

    // Advanced Options
    const pacing = pacingSelect.value;
    const persona = personaSelect.value;
    const pitch = pitchSelect.value;
    const sampleRate = parseInt(audioQualitySelect.value, 10);
    const naturalPauses = naturalPausesCheckbox.checked;

    if (!apiKey) {
        setStatus('Please enter your Gemini API Key.', 'error');
        return;
    }
    if (!text) {
        setStatus('Please enter some text to synthesize.', 'error');
        return;
    }

    // Save API key
    localStorage.setItem('gemini_api_key', apiKey);

    initAudioContext(sampleRate);

    // Reset state
    recordedChunks = [];
    audioQueue = [];
    isPlaying = false;
    textChunksQueue = splitTextIntoChunks(text);
    totalChunks = textChunksQueue.length;
    currentChunkIndex = 0;

    if (currentAudioBlobUrl) {
        URL.revokeObjectURL(currentAudioBlobUrl);
        currentAudioBlobUrl = null;
    }
    audioContainer.classList.add('hidden');
    downloadBtn.disabled = true;

    setLoading(true);
    setStatus('Connecting to Gemini AI...', 'generating');

    try {
        const url = `${WS_URL}?key=${apiKey}`;
        ws = new WebSocket(url);

        ws.onopen = () => {
            setStatus('Sending instructions...', 'generating');
            sendSetupMessage(voiceName, emotion, pacing, persona, pitch, naturalPauses);
            // Wait for setupComplete before sending text chunks
        };

        ws.onmessage = async (event) => {
            if (event.data instanceof Blob) {
                // Not used here, expecting text/JSON frame as per docs or parsed blob
                const text = await event.data.text();
                handleServerMessage(JSON.parse(text));
            } else {
                const message = JSON.parse(event.data);
                handleServerMessage(message);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket Error:', error);
            setStatus('Connection error. Check API key and network.', 'error');
            setLoading(false);
        };

        ws.onclose = (event) => {
            setLoading(false);
            if (recordedChunks.length > 0 && textChunksQueue.length === 0) {
                setStatus('Generation complete!', 'success');
                finalizeAudio(sampleRate);
            } else if (recordedChunks.length > 0 && textChunksQueue.length > 0) {
                setStatus(`Stopped early. Generated ${currentChunkIndex} of ${totalChunks} parts.`, 'success');
                finalizeAudio(sampleRate);
            } else {
                if (statusText.className.includes('generating')) {
                    setStatus(`Disconnected unexpectedly (Code: ${event.code}).`, 'error');
                }
            }
        };

    } catch (err) {
        setStatus(`Error: ${err.message}`, 'error');
        setLoading(false);
    }
}

function sendSetupMessage(voiceName, emotion, pacing, persona, pitch, naturalPauses) {
    let instruction = `You are an expert voice actor. Please read the following text with a ${emotion} emotion and tone.`;

    if (persona !== "None") {
        instruction += ` Adopt the persona of a professional ${persona}.`;
    }

    if (pacing === "Slow") {
        instruction += ` Speak very slowly, clearly, and deliberately.`;
    } else if (pacing === "Fast") {
        instruction += ` Speak fast, briskly, and energetically.`;
    }

    if (pitch === "Deep") {
        instruction += ` Use a noticeably deeper, lower-pitched voice.`;
    } else if (pitch === "High") {
        instruction += ` Use a noticeably higher-pitched voice.`;
    }

    if (naturalPauses) {
        instruction += ` Add natural breathing pauses and deliberate pauses between sentences for realism.`;
    }

    instruction += ` CRITICAL INSTRUCTION: You must read the text EXACTLY in its original language. If the text is in Burmese (Myanmar), you MUST speak in Burmese. DO NOT translate the text to English or any other language under any circumstances. DO NOT add any extra commentary or text. Ensure you read the text exactly as written, word by word, in detail, without missing anything. Inflect it heavily with these instructions.`;

    const setupMsg = {
        setup: {
            model: "models/gemini-2.5-flash-native-audio-latest",
            generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                    voiceConfig: {
                        prebuiltVoiceConfig: {
                            voiceName: voiceName
                        }
                    }
                }
            },
            systemInstruction: {
                parts: [{ text: instruction }]
            }
        }
    };
    ws.send(JSON.stringify(setupMsg));
}

function splitTextIntoChunks(text) {
    // Split by sentence endings (., !, ?) or newlines, keeping the punctuation
    const regex = /[^.!?\n]+[.!?\n]+/g;
    let chunks = text.match(regex);
    if (!chunks) {
        chunks = [text];
    } else {
        const remaining = text.replace(regex, '');
        if (remaining.trim()) {
            chunks.push(remaining);
        }
    }
    return chunks.map(c => c.trim()).filter(c => c.length > 0);
}

function sendNextTextChunk() {
    if (textChunksQueue.length === 0) return;
    currentChunkIndex++;
    setStatus(`Generating audio... (Part ${currentChunkIndex} of ${totalChunks})`, 'generating');

    const chunk = textChunksQueue.shift();
    sendTextMessage(chunk);
}

function sendTextMessage(text) {
    const clientContentMsg = {
        clientContent: {
            turns: [
                {
                    role: "user",
                    parts: [{ text: text }]
                }
            ],
            turnComplete: true
        }
    };
    ws.send(JSON.stringify(clientContentMsg));
}

function sendEndOfTurn() {
    // Not needed if we use turnComplete: true in clientContent.
}

function handleServerMessage(message) {
    if (message.error) {
        console.error("Gemini API Error:", message.error);
        setStatus(`API Error: ${message.error.message || "Unknown error"}`, 'error');
        ws.close();
        return;
    }

    if (message.setupComplete) {
        setStatus('Setup complete. Sending text...', 'generating');
        sendNextTextChunk();
        return;
    }

    if (message.serverContent && message.serverContent.modelTurn) {
        const parts = message.serverContent.modelTurn.parts;
        for (const part of parts) {
            if (part.inlineData && part.inlineData.data) {
                // Base64 encoded pcm_16 data
                const base64Data = part.inlineData.data;
                const pcmData = base64ToArrayBuffer(base64Data);
                recordedChunks.push(pcmData);
                queueAudio(pcmData);
            }
        }
    }

    if (message.serverContent && message.serverContent.turnComplete) {
        if (textChunksQueue.length > 0) {
            // Need a slight delay to avoid overwhelming the Live API turn management which can cause 1008.
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    sendNextTextChunk();
                }
            }, 500);
        } else {
            setStatus('Generation complete!', 'success');
            // Slight delay before close to ensure all audio plays out properly
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.close();
                }
            }, 1000);
        }
    }
}

// Convert base64 to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}

// Queue Audio for playback
async function queueAudio(pcmBuffer) {
    if (!autoPlayCheckbox.checked) return;

    const sampleRate = parseInt(audioQualitySelect.value, 10);
    const int16Array = new Int16Array(pcmBuffer);
    const audioBuffer = audioContext.createBuffer(1, int16Array.length, sampleRate);
    const channelData = audioBuffer.getChannelData(0);

    // Convert Int16 to Float32
    for (let i = 0; i < int16Array.length; i++) {
        channelData[i] = int16Array[i] / 32768.0;
    }

    audioQueue.push(audioBuffer);
    if (!isPlaying) {
        playNextInQueue();
    }
}

function playNextInQueue() {
    if (audioQueue.length === 0) {
        isPlaying = false;
        return;
    }
    isPlaying = true;
    const audioBuffer = audioQueue.shift();
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioContext.destination);
    source.onended = playNextInQueue;
    source.start(0);
}

// Create WAV file from recorded chunks
function finalizeAudio(sampleRate) {
    let totalLength = 0;
    for (const chunk of recordedChunks) {
        totalLength += chunk.byteLength;
    }

    const resultBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of recordedChunks) {
        resultBuffer.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
    }

    // Create WAV header
    const wavBytes = encodeWAV(resultBuffer, sampleRate);
    const blob = new Blob([wavBytes], { type: 'audio/wav' });
    currentAudioBlobUrl = URL.createObjectURL(blob);

    audioPlayer.src = currentAudioBlobUrl;
    audioContainer.classList.remove('hidden');
    downloadBtn.disabled = false;
}

function encodeWAV(pcmBuffer, sampleRate) {
    const numChannels = 1;
    const sampleBits = 16;
    const dataByteLength = pcmBuffer.length;
    const buffer = new ArrayBuffer(44 + dataByteLength);
    const view = new DataView(buffer);

    // RIFF chunk descriptor
    writeUTFBytes(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataByteLength, true); // file length minus 8
    writeUTFBytes(view, 8, 'WAVE');

    // FMT sub-chunk
    writeUTFBytes(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
    view.setUint16(22, numChannels, true); // NumChannels
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * numChannels * (sampleBits / 8), true); // ByteRate
    view.setUint16(32, numChannels * (sampleBits / 8), true); // BlockAlign
    view.setUint16(34, sampleBits, true); // BitsPerSample

    // Data sub-chunk
    writeUTFBytes(view, 36, 'data');
    view.setUint32(40, dataByteLength, true); // Subchunk2Size

    // Write PCM samples
    const pcmView = new Uint8Array(pcmBuffer);
    const targetView = new Uint8Array(buffer, 44);
    targetView.set(pcmView);

    return buffer;
}

function writeUTFBytes(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

function handleDownload() {
    if (!currentAudioBlobUrl) return;
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = currentAudioBlobUrl;

    const textPreview = textInput.value.trim().substring(0, 15).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = `autotts_${textPreview || 'audio'}.wav`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function setStatus(text, type) {
    statusText.innerText = text;
    statusText.className = 'status-text';
    if (type) {
        statusText.classList.add(type);
    }
}

function setLoading(isLoading) {
    if (isLoading) {
        generateBtn.disabled = true;
        loader.classList.remove('hidden');
        generateBtn.querySelector('.btn-text').textContent = 'Generating...';
    } else {
        generateBtn.disabled = false;
        loader.classList.add('hidden');
        generateBtn.querySelector('.btn-text').textContent = 'Generate Audio';
    }
}

// Run init
init();
