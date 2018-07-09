const API_ENDPOINT = "https://api.assemblyai.com/stream";
const API_TOKEN = "";

// navigator.getUserMedia shim
navigator.getUserMedia =
  navigator.getUserMedia ||
  navigator.webkitGetUserMedia ||
  navigator.mozGetUserMedia ||
  navigator.msGetUserMedia;

// URL shim
window.URL = window.URL || window.webkitURL;

// audio context + .createScriptProcessor shim
var audioContext = new AudioContext;
if (audioContext.createScriptProcessor == null)
  audioContext.createScriptProcessor = audioContext.createJavaScriptNode;

// elements (jQuery objects)
var $recording = $('#recording'),
    $timeDisplay = $('#time-display'),
    $record = $('#record'),
    $cancel = $('#cancel'),
    $loader = $('#loader'),
    $results = $('#results'),
    $status = $('#status'),
    $confidence = $('#confidence'),
    $text = $('#text');

/*
master diagram

(microphone)---+--->(input)--->(processor)
                               |
                               v
                         (destination)
*/
var microphone = undefined,     // on stream initialization
    input = audioContext.createGain(),
    processor = undefined;      // created on recording

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
    microphone.connect(input);
  },
  function(error) {
    window.alert("Could not get audio input.");
});

// processor buffer size
var BUFFER_SIZE = [256, 512, 1024, 2048, 4096, 8192, 16384];

var defaultBufSz = (function() {
  processor = audioContext.createScriptProcessor(undefined, 2, 2);
  return processor.bufferSize;
})();

var iDefBufSz = BUFFER_SIZE.indexOf(defaultBufSz);

// save/delete recording
function saveRecording(blob) {
  let fileReader = new FileReader();
  let arrayBuffer;
  fileReader.readAsArrayBuffer(blob);
  fileReader.onloadend = () => {
      arrayBuffer = fileReader.result;
      audioContext.decodeAudioData(arrayBuffer).then(function(decodedData) {
        var sampleRateRatio = decodedData.sampleRate / 8000;
        var newLength = Math.round(decodedData.length / sampleRateRatio);
        var offlineAudioContext = new OfflineAudioContext(1, newLength, 8000);
        var offlineSource = offlineAudioContext.createBufferSource();
        offlineSource.buffer = decodedData;
        offlineSource.connect(offlineAudioContext.destination);
        offlineSource.start();
        offlineAudioContext.startRendering().then(function(renderedBuffer) {
          console.log('Downsampling successful');
          var wav = createWaveFileData(renderedBuffer);
          var base64 = btoa(uint8ToString(wav));
          transcribe(base64);

          // Playback downsampled recording
          // var song = audioContext.createBufferSource();
          // song.buffer = renderedBuffer;
          // song.connect(audioContext.destination);
          // song.start();
        }).catch(function(err) {
            console.log('Rendering failed: ' + err);
            // Note: The promise should reject when startRendering is called a second time on an OfflineAudioContext
        });
      });
  }
}

// recording process
var worker = new Worker('js/EncoderWorker.js'),
    encoder = undefined;        // used on encodingProcess == direct

worker.onmessage = function(event) { saveRecording(event.data.blob); };

function getBuffers(event) {
  var buffers = [];
  for (var ch = 0; ch < 2; ++ch)
    buffers[ch] = event.inputBuffer.getChannelData(ch);
  return buffers;
}

function startRecordingProcess() {
  var bufSz = BUFFER_SIZE[BUFFER_SIZE.indexOf(defaultBufSz)];
  processor = audioContext.createScriptProcessor(bufSz, 2, 2);
  input.connect(processor);
  processor.connect(audioContext.destination);
  worker.postMessage({
    command: 'start',
    process: 'separate',
    sampleRate: audioContext.sampleRate,
    numChannels: 1
  });
  processor.onaudioprocess = function(event) {
    worker.postMessage({ command: 'record', buffers: getBuffers(event) });
  };
}

function stopRecordingProcess(finish) {
  input.disconnect();
  processor.disconnect();
  worker.postMessage({ command: finish ? 'finish' : 'cancel' });
}

// recording buttons interface
var startTime = null    // null indicates recording is stopped

function minSecStr(n) { return (n < 10 ? "0" : "") + n; }

function updateDateTime() {
  if (startTime != null) {
    var sec = Math.floor((Date.now() - startTime) / 1000);
    $timeDisplay.html(minSecStr(sec / 60 | 0) + ":" + minSecStr(sec % 60));
  }
}

window.setInterval(updateDateTime, 200);

function startRecording() {
  startTime = Date.now();
  $recording.removeClass('hidden');
  $timeDisplay.removeClass('hidden');
  $results.addClass('hidden');
  $record.html('STOP');
  $cancel.removeClass('hidden');
  startRecordingProcess();
}

function stopRecording(finish) {
  startTime = null;
  $timeDisplay.html('00:00');
  $recording.addClass('hidden');
  $timeDisplay.addClass('hidden');
  $record.html('RECORD');
  $cancel.addClass('hidden');
  stopRecordingProcess(finish);
}

function transcribe(data) {
  var payload = {
    '8k_pcm_data': data
  };

  $loader.removeClass('hidden');
  $.ajax({
      url: API_ENDPOINT,
      type: 'POST',
      data: JSON.stringify(payload),
      headers: {
        'authorization': API_TOKEN
      },
      contentType: "application/json; charset=utf-8",
      dataType: "json"
  }).done(function(response) {
    console.log(response);

    if (response) {
      if (response.transcript) {
        $status.html(response.transcript.status);
        $confidence.html(response.transcript.confidence);
        $text.html(response.transcript.text);
      }
    }

    $results.removeClass('hidden');
  }).always(function() {
    $loader.addClass('hidden');
  });
}

$record.click(function() {
  if (startTime != null)
    stopRecording(true);
  else
    startRecording();
});

$cancel.click(function() { stopRecording(false); });
