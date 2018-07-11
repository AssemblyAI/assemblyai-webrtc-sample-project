"use strict";

const API_ENDPOINT = "https://api.assemblyai.com/stream";
const BUFFER_SIZE = [256, 512, 1024, 2048, 4096, 8192, 16384];
const PCM_DATA_SAMPLE_RATE = 8000;

// Audio context + .createScriptProcessor shim
var audioContext = new AudioContext;
if (audioContext.createScriptProcessor == null) {
  audioContext.createScriptProcessor = audioContext.createJavaScriptNode;
}

var microphone = undefined; // on stream initialization
var input = audioContext.createGain();
var processor = audioContext.createScriptProcessor(undefined, 2, 2);

// Navigator.getUserMedia shim
navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia ||
  navigator.msGetUserMedia;

// Initialize stream
navigator.getUserMedia({ audio: true },
  function(stream) {
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(input);
  },
  function(error) {
    window.alert("Could not get audio input");
});

class AssemblyAI {
  constructor(token) {
    var self = this;
    this.token = token;
    this.worker = new Worker('js/lib/EncoderWorker.js');
    this.worker.onmessage = function(event) { self._processRecording(event.data.blob); };
    this.callback = undefined;
  }

  /**
   * Methods
   */

  startRecording() {
    this._startRecordingProcess();
  }

  stopRecording(callback) {
    this.callback = callback;
    this._stopRecordingProcess(true);
  }

  cancelRecording() {
    this._stopRecordingProcess();
  }

  _getBuffers(event) {
     var buffers = [];
     for (var ch = 0; ch < 2; ++ch)
       buffers[ch] = event.inputBuffer.getChannelData(ch);
     return buffers;
   }

  _startRecordingProcess() {
    var self = this;
    var bufferSize = BUFFER_SIZE[BUFFER_SIZE.indexOf(processor.bufferSize)];
    processor = audioContext.createScriptProcessor(bufferSize, 2, 2);
    input.connect(processor);
    processor.connect(audioContext.destination);
    this.worker.postMessage({
     command: 'start',
     process: 'separate',
     sampleRate: audioContext.sampleRate,
     numChannels: 2
    });
    processor.onaudioprocess = function(event) {
     self.worker.postMessage({ command: 'record', buffers: self._getBuffers(event) });
    };
  }

  _stopRecordingProcess(finish) {
    input.disconnect();
    processor.disconnect();
    this.worker.postMessage({ command: finish ? 'finish' : 'cancel' });
  }

  _processRecording(blob) {
    let self = this;
    let fileReader = new FileReader();
    fileReader.readAsArrayBuffer(blob);
    fileReader.onloadend = () => {
      let arrayBuffer = fileReader.result;
      audioContext.decodeAudioData(arrayBuffer).then(function(decodedData) {
        var sampleRateRatio = decodedData.sampleRate / PCM_DATA_SAMPLE_RATE;
        var newLength = Math.round(decodedData.length / sampleRateRatio);
        var offlineAudioContext = new OfflineAudioContext(1, newLength, PCM_DATA_SAMPLE_RATE);
        var offlineSource = offlineAudioContext.createBufferSource();
        offlineSource.buffer = decodedData;
        offlineSource.connect(offlineAudioContext.destination);
        offlineSource.start();
        offlineAudioContext.startRendering().then(function(renderedBuffer) {
          var wav = self._createWaveFileData(renderedBuffer);
          var base64 = btoa(self._uint8ToString(wav));
          self._transcribe(base64);
        }).catch(function(err) {
          console.log('Rendering failed: ' + err);
          // Note: The promise should reject when startRendering is called a second time on an OfflineAudioContext
        });
      });
    }
  }

  _transcribe(data) {
    var self = this;
    $.ajax({
        url: API_ENDPOINT,
        type: 'POST',
        data: JSON.stringify({ '8k_pcm_data': data }),
        headers: { 'authorization': this.token },
        contentType: "application/json; charset=utf-8",
        dataType: "json"
    }).done(function(response) {
      self.callback(response.transcript);

      // Reset instance callback
      self.callback = null;
    });
  }

  _writeString(s, a, offset) {
    for (var i = 0; i < s.length; ++i) {
      a[offset + i] = s.charCodeAt(i);
    }
  }

  _writeInt16(n, a, offset) {
    n = Math.floor(n);

    var b1 = n & 255;
    var b2 = (n >> 8) & 255;

    a[offset + 0] = b1;
    a[offset + 1] = b2;
  }

  _writeInt32(n, a, offset) {
    n = Math.floor(n);
    var b1 = n & 255;
    var b2 = (n >> 8) & 255;
    var b3 = (n >> 16) & 255;
    var b4 = (n >> 24) & 255;

    a[offset + 0] = b1;
    a[offset + 1] = b2;
    a[offset + 2] = b3;
    a[offset + 3] = b4;
  }

  _writeAudioBuffer(audioBuffer, a, offset) {
    var n = audioBuffer.length;
    var channels = audioBuffer.numberOfChannels;

    for (var i = 0; i < n; ++i) {
      for (var k = 0; k < channels; ++k) {
        var buffer = audioBuffer.getChannelData(k);
        var sample = buffer[i] * 32768.0;

        // Clip samples to the limitations of 16-bit.
        // If we don't do this then we'll get nasty wrap-around distortion.
        if (sample < -32768)
            sample = -32768;
        if (sample > 32767)
            sample = 32767;

        this._writeInt16(sample, a, offset);
        offset += 2;
      }
    }
  }

  _uint8ToString(buf) {
    var i, length, out = '';
    for (i = 0, length = buf.length; i < length; i += 1) {
      out += String.fromCharCode(buf[i]);
    }
    return out;
  }

  _createWaveFileData(audioBuffer) {
    var frameLength = audioBuffer.length;
    var numberOfChannels = audioBuffer.numberOfChannels;
    var sampleRate = audioBuffer.sampleRate;
    var bitsPerSample = 16;
    var byteRate = sampleRate * numberOfChannels * bitsPerSample/8;
    var blockAlign = numberOfChannels * bitsPerSample/8;
    var wavDataByteLength = frameLength * numberOfChannels * 2; // 16-bit audio
    var headerByteLength = 44;
    var totalLength = headerByteLength + wavDataByteLength;

    var waveFileData = new Uint8Array(totalLength);

    var subChunk1Size = 16; // for linear PCM
    var subChunk2Size = wavDataByteLength;
    var chunkSize = 4 + (8 + subChunk1Size) + (8 + subChunk2Size);

    this._writeString("RIFF", waveFileData, 0);
    this._writeInt32(chunkSize, waveFileData, 4);
    this._writeString("WAVE", waveFileData, 8);
    this._writeString("fmt ", waveFileData, 12);

    this._writeInt32(subChunk1Size, waveFileData, 16);      // SubChunk1Size (4)
    this._writeInt16(1, waveFileData, 20);                  // AudioFormat (2)
    this._writeInt16(numberOfChannels, waveFileData, 22);   // NumChannels (2)
    this._writeInt32(sampleRate, waveFileData, 24);         // SampleRate (4)
    this._writeInt32(byteRate, waveFileData, 28);           // ByteRate (4)
    this._writeInt16(blockAlign, waveFileData, 32);         // BlockAlign (2)
    this._writeInt32(bitsPerSample, waveFileData, 34);      // BitsPerSample (4)

    this._writeString("data", waveFileData, 36);
    this._writeInt32(subChunk2Size, waveFileData, 40);      // SubChunk2Size (4)

    // Write actual audio data starting at offset 44.
    this._writeAudioBuffer(audioBuffer, waveFileData, 44);

    return waveFileData;
  }
}

