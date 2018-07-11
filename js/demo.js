(function( $ ) {
  const API_TOKEN = "35f2294b909141b4b62a52b98adc59eb";

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

	$(window).on('load', function () {
    // Instantiate AssemblyAI object 
    var assemblyai = new AssemblyAI(API_TOKEN);

    $('#record').click(function(){
      if (isRecording) {
        // UI
        startTime = null;
        $(this).html('RECORD');
        $('#recording').addClass('hidden');
        $('#time-display').addClass('hidden');
        clearInterval(updateTimeDisplayInterval);

        $('#loader').removeClass('hidden');
        assemblyai.stopRecording(function(response){
          $('#loader').addClass('hidden');
          console.log(response);

          // UI
          $('#status').text(response.status);
          $('#confidence').text(response.confidence);
          $('#text').text(response.text);
          $('#results').removeClass('hidden');
          $('#recording').addClass('hidden');
        });
        isRecording = false;
      } else {

        assemblyai.startRecording();
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
 	});

	$(function() {

	});
})( jQuery );





