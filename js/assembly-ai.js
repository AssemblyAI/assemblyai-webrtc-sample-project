"use strict";

const API_ENDPOINT = "https://api.assemblyai.com/stream";
const BUFFER_SIZE = [256, 512, 1024, 2048, 4096, 8192, 16384];
const PCM_DATA_SAMPLE_RATE = 8000;

// Get wrapper script path
var scriptPath = '';
if (document.currentScript) {
  var hostname = window.location.hostname;
  var filename = document.currentScript.src.substr(document.currentScript.src.lastIndexOf('/') + 1);
  var segments = document.currentScript.src.replace('https://','').replace('http://','').split('/');
  for (var i = 0; i < segments.length; i++) {
    if (segments[i].includes(hostname) || segments[i].includes(filename)) {
      continue;
    }
    scriptPath += segments[i] + '/';
  }
}

// Audio context + .createScriptProcessor shim
var audioContext = new AudioContext;
if (audioContext.createScriptProcessor == null) {
  audioContext.createScriptProcessor = audioContext.createJavaScriptNode;
}

var microphone = undefined; // on stream initialization
var processor = audioContext.createScriptProcessor(undefined, 2, 2);

// Navigator.getUserMedia shim
navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia ||
  navigator.msGetUserMedia;

// Initialize stream
var constraints = {
  audio: {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }
};
navigator.getUserMedia(constraints,
  function(stream) {
    microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(processor);
  },
  function(error) {
    window.alert("Could not get audio input");
});

// Define VAD (voice activity detection) variable
class AssemblyAI {
  constructor(token) {
    var self = this;
    this.token = token; // AssemblyAI API token
    this.base64 = undefined; // Base64 encoded audio/wav data
    this.vad = undefined; // Voice activity detector
    this.isRecording = false; // Boolean indicating recording status
    this.worker = new Worker(scriptPath+'lib/EncoderWorker.js'); // worker script to encode audio stream in wav format
    this.worker.onmessage = function(event) { self._processRecording(event.data.blob); }; // worker script callback
    this.callback = undefined;
  }

  /**
   * Methods
   */

  startRecording(autoStop=false, transriptionCallback, uiCallback) {
    var self = this;
    this._startRecordingProcess();
    this.isRecording = true;
    // Auto stop
    if (autoStop && transriptionCallback) {
      var options = {
        source: microphone,
        voice_stop: function() {
          if (self.isRecording) {
            console.log('voice_stop');
            self.stopRecording(transriptionCallback);

            if (uiCallback) {
              uiCallback();
            }
          }
        }
      };

      // Create VAD
      this.vad = new VAD(options);
    }
  }

  stopRecording(callback) {
    this.isRecording = false;
    this.callback = callback;
    this._stopRecordingProcess(true);
  }

  cancelRecording() {
    this.isRecording = false;
    this._stopRecordingProcess();
  }

  saveRecording() {
    if (this.base64 && this.base64 != undefined) {
      var blob = this._base64toBlob(this.base64, 'audio/wav');
      var date = new Date();
      var fileName = "recording-"+(date.getMonth()+1)+"."+date.getDate()+"."+date.getFullYear()+"-"+date.getHours()+"."+date.getMinutes()+"."+date.getSeconds()+".wav";
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.click();
    }
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
    microphone.connect(processor);
    processor.connect(audioContext.destination);
    this.worker.postMessage({
     command: 'start',
     process: 'separate',
     sampleRate: audioContext.sampleRate,
     numChannels: 1
    });
    processor.onaudioprocess = function(event) {
     self.worker.postMessage({ command: 'record', buffers: self._getBuffers(event) });
    };
  }

  _stopRecordingProcess(finish) {
    microphone.disconnect();
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
          self.base64 = btoa(self._uint8ToString(wav));
          self._transcribe(self.base64);
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

  _base64toBlob(base64Data, contentType) {
    contentType = contentType || '';
    var sliceSize = 1024;
    var byteCharacters = atob(base64Data);
    var bytesLength = byteCharacters.length;
    var slicesCount = Math.ceil(bytesLength / sliceSize);
    var byteArrays = new Array(slicesCount);

    for (var sliceIndex = 0; sliceIndex < slicesCount; ++sliceIndex) {
        var begin = sliceIndex * sliceSize;
        var end = Math.min(begin + sliceSize, bytesLength);

        var bytes = new Array(end - begin);
        for (var offset = begin, i = 0; offset < end; ++i, ++offset) {
            bytes[i] = byteCharacters[offset].charCodeAt(0);
        }
        byteArrays[sliceIndex] = new Uint8Array(bytes);
    }
    return new Blob(byteArrays, { type: contentType });
  }
}

var VAD = function(options) {
  // Default options
  this.options = {
    fftSize: 512,
    bufferLen: 512,
    voice_stop: function() {},
    voice_start: function() {},
    smoothingTimeConstant: 0.99,
    energy_offset: 1e-8, // The initial offset.
    energy_threshold_ratio_pos: 2, // Signal must be twice the offset
    energy_threshold_ratio_neg: 0.5, // Signal must be half the offset
    energy_integration: 1, // Size of integration change compared to the signal per second.
    filter: [
      {f: 200, v:0}, // 0 -> 200 is 0
      {f: 2000, v:1} // 200 -> 2k is 1
    ],
    source: null,
    context: null
  };

  // User options
  for(var option in options) {
    if(options.hasOwnProperty(option)) {
      this.options[option] = options[option];
    }
  }

  // Require source
 if(!this.options.source)
   throw new Error("The options must specify a MediaStreamAudioSourceNode.");

  // Set this.options.context
  this.options.context = this.options.source.context;

  // Calculate time relationships
  this.hertzPerBin = this.options.context.sampleRate / this.options.fftSize;
  this.iterationFrequency = this.options.context.sampleRate / this.options.bufferLen;
  this.iterationPeriod = 1 / this.iterationFrequency;

  var DEBUG = true;
  if(DEBUG) console.log(
    'Vad' +
    ' | sampleRate: ' + this.options.context.sampleRate +
    ' | hertzPerBin: ' + this.hertzPerBin +
    ' | iterationFrequency: ' + this.iterationFrequency +
    ' | iterationPeriod: ' + this.iterationPeriod
  );

  this.setFilter = function(shape) {
    this.filter = [];
    for(var i = 0, iLen = this.options.fftSize / 2; i < iLen; i++) {
      this.filter[i] = 0;
      for(var j = 0, jLen = shape.length; j < jLen; j++) {
        if(i * this.hertzPerBin < shape[j].f) {
          this.filter[i] = shape[j].v;
          break; // Exit j loop
        }
      }
    }
  }

  this.setFilter(this.options.filter);

  this.ready = {};
  this.vadState = false; // True when Voice Activity Detected

  // Energy detector props
  this.energy_offset = this.options.energy_offset;
  this.energy_threshold_pos = this.energy_offset * this.options.energy_threshold_ratio_pos;
  this.energy_threshold_neg = this.energy_offset * this.options.energy_threshold_ratio_neg;

  this.voiceTrend = 0;
  this.voiceTrendMax = 10;
  this.voiceTrendMin = -10;
  this.voiceTrendStart = 5;
  this.voiceTrendEnd = -5;

  // Create analyser
  this.analyser = this.options.context.createAnalyser();
  this.analyser.smoothingTimeConstant = this.options.smoothingTimeConstant; // 0.99;
  this.analyser.fftSize = this.options.fftSize;

  this.floatFrequencyData = new Float32Array(this.analyser.frequencyBinCount);

  // Setup local storage of the Linear FFT data
  this.floatFrequencyDataLinear = new Float32Array(this.floatFrequencyData.length);

  // Connect this.analyser
  this.options.source.connect(this.analyser);

  // Create ScriptProcessorNode
  this.scriptProcessorNode = this.options.context.createScriptProcessor(this.options.bufferLen, 1, 1);

  // Connect scriptProcessorNode (Theretically, not required)
  this.scriptProcessorNode.connect(this.options.context.destination);

  // Create callback to update/analyze floatFrequencyData
  var self = this;
  this.scriptProcessorNode.onaudioprocess = function(event) {
    self.analyser.getFloatFrequencyData(self.floatFrequencyData);
    self.update();
    self.monitor();
  };

  // Connect scriptProcessorNode
  this.options.source.connect(this.scriptProcessorNode);

  // log stuff
  this.logging = false;
  this.log_i = 0;
  this.log_limit = 100;

  this.triggerLog = function(limit) {
    this.logging = true;
    this.log_i = 0;
    this.log_limit = typeof limit === 'number' ? limit : this.log_limit;
  }

  this.log = function(msg) {
    if(this.logging && this.log_i < this.log_limit) {
      this.log_i++;
      console.log(msg);
    } else {
      this.logging = false;
    }
  }

  this.update = function() {
    // Update the local version of the Linear FFT
    var fft = this.floatFrequencyData;
    for(var i = 0, iLen = fft.length; i < iLen; i++) {
      this.floatFrequencyDataLinear[i] = Math.pow(10, fft[i] / 10);
    }
    this.ready = {};
  }

  this.getEnergy = function() {
    if(this.ready.energy) {
      return this.energy;
    }

    var energy = 0;
    var fft = this.floatFrequencyDataLinear;

    for(var i = 0, iLen = fft.length; i < iLen; i++) {
      energy += this.filter[i] * fft[i] * fft[i];
    }

    this.energy = energy;
    this.ready.energy = true;

    return energy;
  }

  this.monitor = function() {
    var energy = this.getEnergy();
    var signal = energy - this.energy_offset;

    if(signal > this.energy_threshold_pos) {
      this.voiceTrend = (this.voiceTrend + 1 > this.voiceTrendMax) ? this.voiceTrendMax : this.voiceTrend + 1;
    } else if(signal < -this.energy_threshold_neg) {
      this.voiceTrend = (this.voiceTrend - 1 < this.voiceTrendMin) ? this.voiceTrendMin : this.voiceTrend - 1;
    } else {
      // voiceTrend gets smaller
      if(this.voiceTrend > 0) {
        this.voiceTrend--;
      } else if(this.voiceTrend < 0) {
        this.voiceTrend++;
      }
    }

    var start = false, end = false;
    if(this.voiceTrend > this.voiceTrendStart) {
      // Start of speech detected
      start = true;
    } else if(this.voiceTrend < this.voiceTrendEnd) {
      // End of speech detected
      end = true;
    }

    // Integration brings in the real-time aspect through the relationship with the frequency this functions is called.
    var integration = signal * this.iterationPeriod * this.options.energy_integration;

    // Idea?: The integration is affected by the voiceTrend magnitude? - Not sure. Not doing atm.

    // The !end limits the offset delta boost till after the end is detected.
    if(integration > 0 || !end) {
      this.energy_offset += integration;
    } else {
      this.energy_offset += integration * 10;
    }
    this.energy_offset = this.energy_offset < 0 ? 0 : this.energy_offset;
    this.energy_threshold_pos = this.energy_offset * this.options.energy_threshold_ratio_pos;
    this.energy_threshold_neg = this.energy_offset * this.options.energy_threshold_ratio_neg;

    // Broadcast the messages
    if(start && !this.vadState) {
      this.vadState = true;
      this.options.voice_start();
    }
    if(end && this.vadState) {
      this.vadState = false;
      this.options.voice_stop();
    }

    this.log(
      'e: ' + energy +
      ' | e_of: ' + this.energy_offset +
      ' | e+_th: ' + this.energy_threshold_pos +
      ' | e-_th: ' + this.energy_threshold_neg +
      ' | signal: ' + signal +
      ' | int: ' + integration +
      ' | voiceTrend: ' + this.voiceTrend +
      ' | start: ' + start +
      ' | end: ' + end
    );

    return signal;
  }
};

