# AssemblyAI Sample WebRTC Project

This sample project uses the WebRTC APIs to stream audio from the browser to the AssemblyAI API for near real-time transcription.

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

1. [Download `ngrok`](https://ngrok.com/download) to serve your local server over HTTPS. Browsers require the website to ber served over HTTPS if you want to access the microphone. Once you unzip the ngrok file, we recommend moving it to `/usr/local/bin` so you have global access to it (ie, `mv ngrok /usr/local/bin/`). Once ngrok is installed, run:

    ```
    # run this to start ngrok
    ngrok http 8000

    # in the ngrok output, find the line that looks like
    Forwarding          https://5b322173.ngrok.io -> localhost:8000
    ```

1. Go to `https://5b322173.ngrok.io` to visit your local server over HTTPS. Click "Allow" when the browser asks for permission to use your microphone.

1. Click the red "RECORD" button and start talking!

