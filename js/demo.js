(function( $ ) {
  const API_TOKEN = "9f05b1697edc4d7b98e9fb3f30575bd9";

  var isRecording = false;
  var startTime = null;
  var updateTimeDisplayInterval = null;

  function minSecStr(n) { return (n < 10 ? "0" : "") + n; }

  function updateTimeDisplay() {
    if (startTime != null) {
      var sec = Math.floor((Date.now() - startTime) / 1000);
      $('#time-display').html(minSecStr(sec / 60 | 0) + ":" + minSecStr(sec % 60));
    }
  }

  function transcriptionCallback(response) {
    $('#loader').addClass('hidden');
    console.log(response);

    // UI
    $('#status').text(response.status);
    $('#confidence').text(response.confidence);
    $('#text').text(response.text);
    $('#results').removeClass('hidden');
    $('#recording').addClass('hidden');
  }

  function uiCallback() {
    // UI
    startTime = null;
    $("#record").html('RECORD');
    $('#recording').addClass('hidden');
    $('#time-display').addClass('hidden');
    clearInterval(updateTimeDisplayInterval);

    $('#loader').removeClass('hidden');
    isRecording = false;
  }

	$(window).on('load', function () {
    var assemblyai = new AssemblyAI(API_TOKEN);

    $('#record').click(function(){
      if (isRecording) {
        uiCallback();
        assemblyai.stopRecording(transcriptionCallback);
      } else {

        assemblyai.startRecording(true, transcriptionCallback, uiCallback);
        isRecording = true;

        // UI
        startTime = Date.now();
        $(this).html('STOP');
        $('#recording').removeClass('hidden');
        $('#time-display').removeClass('hidden');
        $('#results').addClass('hidden');
        updateTimeDisplayInterval = setInterval(updateTimeDisplay, 200);
      }
    });

    $('#save').click(function(){
      assemblyai.saveRecording();
    });
 	});

	$(function() {

	});
})( jQuery );





