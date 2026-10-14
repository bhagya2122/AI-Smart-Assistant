"use strict";


// HTML ELEMENTS

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const emotionResult = document.getElementById("emotion-result");

let cameraStream = null;
let isAnalyzing = false;


// SHOW STATUS

function showStatus(message) {
    if (emotionResult) {
        emotionResult.textContent = message;
    }
}


// START CAMERA

async function startCamera() {
    try {
        if (!video) {
            throw new Error("Video element is missing from index.html.");
        }

        // Already running?
        if (cameraStream) {
            const activeTracks = cameraStream
                .getVideoTracks()
                .filter(track => track.readyState === "live");

            if (activeTracks.length > 0) {
                video.srcObject = cameraStream;
                await video.play();

                showStatus("Camera is already running.");
                return;
            }

            cameraStream = null;
        }

        // Browser camera support
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {

            throw new Error(
                "Camera is unavailable. Open the website using http://127.0.0.1:5000."
            );
        }

        showStatus("Requesting camera permission...");

        // Request camera access
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",
                width: {
                    ideal: 640
                },
                height: {
                    ideal: 480
                }
            },
            audio: false
        });

        cameraStream = stream;

        video.srcObject = cameraStream;
        video.muted = true;
        video.autoplay = true;
        video.playsInline = true;

        // Wait for video metadata
        await new Promise((resolve, reject) => {
            if (video.readyState >= 1) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                cleanup();

                reject(
                    new Error("Camera video did not initialize. Please try again.")
                );
            }, 10000);

            function cleanup() {
                clearTimeout(timeout);

                video.removeEventListener(
                    "loadedmetadata",
                    onLoaded
                );

                video.removeEventListener(
                    "error",
                    onError
                );
            }

            function onLoaded() {
                cleanup();
                resolve();
            }

            function onError() {
                cleanup();

                reject(
                    new Error("Unable to load the camera video.")
                );
            }

            video.addEventListener(
                "loadedmetadata",
                onLoaded,
                { once: true }
            );

            video.addEventListener(
                "error",
                onError,
                { once: true }
            );
        });

        await video.play();

        showStatus(
            "Camera started successfully! Now click Detect Emotion."
        );

    } catch (error) {
        console.error("Camera Error:", error);

        // Release a partially started stream
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }

        if (video) {
            video.srcObject = null;
        }

        showStatus(
            "Camera Error: " + error.message +
            " Check camera permission and close other apps using the camera."
        );
    }
}


// DETECT EMOTION

async function detectEmotion() {
    if (isAnalyzing) {
        return;
    }

    if (!cameraStream) {
        showStatus("Please click Start Camera first.");
        return;
    }

    if (!video || !canvas) {
        showStatus("Video or Canvas element is missing.");
        return;
    }

    if (video.videoWidth === 0 || video.videoHeight === 0) {
        showStatus("Camera is starting. Please wait and try again.");
        return;
    }

    isAnalyzing = true;

    const button = document.getElementById("detect-emotion-btn");

    if (button) {
        button.disabled = true;
        button.textContent = "Analyzing...";
    }

    try {
        // Capture current camera frame
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;

        const context = canvas.getContext("2d");

        context.drawImage(
            video,
            0,
            0,
            canvas.width,
            canvas.height
        );

        const image = canvas.toDataURL("image/jpeg", 0.9);

        showStatus("Analyzing image. Please wait...");

        // Send image to Flask backend
        const response = await fetch("/analyze", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                image: image
            })
        });

        // Handle non-JSON server responses
        let data;

        try {
            data = await response.json();
        } catch {
            throw new Error(
                "Server returned an invalid response. Check app.py and the Flask terminal."
            );
        }

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Emotion detection failed."
            );
        }

        // Display predicted emotion
        const emotion = data.emotion || "unknown";

        showStatus(
            "Detected Emotion: " + emotion.toUpperCase()
        );

        // Update graph
        updateEmotionGraph(data.scores || {});

    } catch (error) {
        console.error("Emotion Detection Error:", error);

        showStatus(
            "Detection Error: " + error.message
        );

    } finally {
        isAnalyzing = false;

        if (button) {
            button.disabled = false;
            button.textContent = "Detect Emotion";
        }
    }
}


// UPDATE EMOTION GRAPH

function updateEmotionGraph(scores) {
    const emotions = [
        "happy",
        "sad",
        "angry",
        "neutral",
        "surprise",
        "fear",
        "disgust"
    ];

    emotions.forEach(emotion => {
        const value = Number(scores[emotion] || 0);

        const safeValue = Math.max(
            0,
            Math.min(100, value)
        );

        const bar = document.getElementById(
            emotion + "-bar"
        );

        const label = document.getElementById(
            emotion + "-value"
        );

        if (bar) {
            bar.style.width = safeValue + "%";
        }

        if (label) {
            label.textContent = safeValue.toFixed(1) + "%";
        }
    });
}


// STOP CAMERA

function stopCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
            track.stop();
        });

        cameraStream = null;
    }

    if (video) {
        video.pause();
        video.srcObject = null;
    }

    showStatus("Camera stopped.");
}


// INITIAL MESSAGE

document.addEventListener("DOMContentLoaded", function () {
    showStatus(
        "Welcome! Click Start Camera to begin emotion detection."
    );
});