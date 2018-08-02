# AssemblyAI Sample WebRTC Project

This sample project uses the [AssemblyAI WebRTC wrapper](https://github.com/AssemblyAI/assemblyai-webrtc-wrapper) to stream audio from the browser to the AssemblyAI API for near real-time speech-to-text.

## Getting started

1. Clone this repo
1. Fill in your API Token on line 2 in `js/demo.js`

    ```
    const API_TOKEN = "your-secret-api-token";
    ```

1. Stand up a simple HTTP Server to serve the static files in this repo

    ```
    # This will start a static server on http://localhost:8000.
    # This server is insecure, and should only be used for demos
    # and testing.
    python -m SimpleHTTPServer
    ```

1. Go to `http://localhost:8000` to visit your local server. Click "Allow" when the browser asks for permission to use your microphone.

> **Note:** WebRTC requires your website to be served on `localhost` or over SSL in order to access the microphone.

1. Click the red "RECORD" button and start talking!

Details about the AssemblyAI wrapper library can be found at [AssemblyAI Wrapper](https://github.com/AssemblyAI/assemblyai-webrtc-wrapper)