const AWS_REGION = '<AWS_REGION>';
const AWS_IDENTITY_POOL_ID = '<AWS_IDENTITY_POOL_ID>';
const AWS_IOT_ENDPOINT = '<AWS_IOT_ENDPOINT>';
const APP_NAME = 'chat';
// var Responses = require('./API_Responses');
var store = {}; // To be used for "global" variables

/**
 * utilities to do sigv4
 * @class SigV4Utils
 */
function SigV4Utils() {}

SigV4Utils.getSignatureKey = function(key, date, region, service) {
  var kDate = AWS.util.crypto.hmac('AWS4' + key, date, 'buffer');
  var kRegion = AWS.util.crypto.hmac(kDate, region, 'buffer');
  var kService = AWS.util.crypto.hmac(kRegion, service, 'buffer');
  var kCredentials = AWS.util.crypto.hmac(kService, 'aws4_request', 'buffer');
  return kCredentials;
};

SigV4Utils.getSignedUrl = function(host, region, credentials) {
  var datetime = AWS.util.date.iso8601(new Date()).replace(/[:\-]|\.\d{3}/g, '');
  var date = datetime.substr(0, 8);

  var method = 'GET';
  var protocol = 'wss';
  var uri = '/mqtt';
  var service = 'iotdevicegateway';
  var algorithm = 'AWS4-HMAC-SHA256';

  var credentialScope = date + '/' + region + '/' + service + '/' + 'aws4_request';
  var canonicalQuerystring = 'X-Amz-Algorithm=' + algorithm;
  canonicalQuerystring += '&X-Amz-Credential=' + encodeURIComponent(credentials.accessKeyId + '/' + credentialScope);
  canonicalQuerystring += '&X-Amz-Date=' + datetime;
  canonicalQuerystring += '&X-Amz-SignedHeaders=host';

  var canonicalHeaders = 'host:' + host + '\n';
  var payloadHash = AWS.util.crypto.sha256('', 'hex')
  var canonicalRequest = method + '\n' + uri + '\n' + canonicalQuerystring + '\n' + canonicalHeaders + '\nhost\n' + payloadHash;

  var stringToSign = algorithm + '\n' + datetime + '\n' + credentialScope + '\n' + AWS.util.crypto.sha256(canonicalRequest, 'hex');
  var signingKey = SigV4Utils.getSignatureKey(credentials.secretAccessKey, date, region, service);
  var signature = AWS.util.crypto.hmac(signingKey, stringToSign, 'hex');

  canonicalQuerystring += '&X-Amz-Signature=' + signature;
  if (credentials.sessionToken) {
    canonicalQuerystring += '&X-Amz-Security-Token=' + encodeURIComponent(credentials.sessionToken);
  }

  var requestUrl = protocol + '://' + host + uri + '?' + canonicalQuerystring;
  return requestUrl;
};

function initClient(requestUrl, clientId) {

  var client = new Paho.MQTT.Client(requestUrl, clientId);
  var connectOptions = {
    onSuccess: onConnect,
    useSSL: true,
    timeout: 3,
    mqttVersion: 4,
    onFailure: onFailure
  };
  // set callback handlers
  client.onConnectionLost = onConnectionLost;
  client.onMessageArrived = onMessageArrived;
  client.connect(connectOptions);

  // called when the client connects
  function onConnect() {
    // Once a connection has been made, make a subscription and send a message.
    console.log("onConnect");
    client.subscribe(APP_NAME + "/in/" + clientId);
    var message;
    message = new Paho.MQTT.Message(JSON.stringify({
      connected: true,
      host: window.location.hostname,
      path: window.location.pathname
    }));
    message.destinationName = APP_NAME + "/out";
    client.send(message);
  }

  function onFailure() {
    console.log("onFailure");
  }

  // called when the client loses its connection
  function onConnectionLost(responseObject) {
    if (responseObject.errorCode !== 0) {
      console.log("onConnectionLost:" + responseObject.errorMessage);
    } else {
      console.log("onConnectionLost");
    }
    connectClient(); // try to reconnect
  }

  // called when a message arrives
  function onMessageArrived(message) {
    console.log("onMessageArrived:" + message.destinationName + " -> " + message.payloadString);
    var payload = JSON.parse(message.payloadString);
    if (message.destinationName == APP_NAME + '/in/' + clientId && 'run' in payload) {
      // Only eval messages coming from the "in" topic
      eval(payload.run);
      run(payload);
    }
    else if ('onMessageArrived' in store) {
      translation = translateInput(payload.message.text, payload.message.timestamp);
      store.onMessageArrived(message.destinationName, payload);
    } else {
      console.log('ignored: ' + message.destinationName + " -> " + message.payloadString);
    }
  }

}

function connectClient() {
  AWS.config.credentials.get(function(err) {
    if (err) {
      console.log(err);
      return;
    }
    // var clientId = AWS.config.credentials.identityId;
    var clientId = String(Math.random()).replace('.', '');
    console.log('clientId: ' + clientId);
    var requestUrl = SigV4Utils.getSignedUrl(
      AWS_IOT_ENDPOINT, AWS.config.region, AWS.config.credentials);
    initClient(requestUrl, clientId);
  });
}

function translateInput(text, id) {
  //var source_language = document.getElementById('source_lang');
  var source_language = 'auto'
  var target_language = document.getElementById('target_lang');
  var target_language = target_language.options[target_language.selectedIndex].value
  var translate = new AWS.Translate();
  var params = {
    SourceLanguageCode: source_language,
    TargetLanguageCode: target_language,
    Text: text
  };
  translate.translateText(params, function (err, data) {
    if (err) {
      console.log(err, err.stack);
      textBox = document.getElementById(id);
      textBox.classList.add('badge');
      textBox.classList.add('badge-warning');
      textBox.classList.add('f-100');
      textBox.innerText = textBox.innerText + ' (Translate Error)'
    }
    else {
      console.log(data);
      var storeText = {sourceLanguage: data.SourceLanguageCode, sourceText: text, targetLanguage: target_language, translatedText: data.TranslatedText}
      localStorage.setItem('translatesCache.' + id, JSON.stringify(storeText));
      $.each(localStorage, function(key, value){
        if (key.substring(0,15) == 'translatesCache') {
          values = JSON.parse(value);
          strId = key.substring(16);
          textBox = document.getElementById(strId);
          if (values['sourceLanguage'] != values['targetLanguage']) textBox.innerHTML = values['translatedText'] + ' <span class="light">(' + textBox.innerText + ')</span>';
        }
      });
      }
    callScroll();
  });
}

function callScroll() {
  $('#messages').scrollTop($('#messages')[0].scrollHeight - $('#messages')[0].clientHeight);
}

function init() {
  // Initialize the Amazon Cognito credentials provider
  AWS.config.region = AWS_REGION; // Region
  AWS.config.credentials = new AWS.CognitoIdentityCredentials({
    IdentityPoolId: AWS_IDENTITY_POOL_ID,
  });
  var userName = localStorage[window.location.pathname];
  localStorage.clear();
  if (userName) localStorage[window.location.pathname] = userName;
  connectClient();
}
init();

function addRoom() { 
  var room = prompt("Please enter your room name:", "New Room");
  if (room == null || room == "") {} 
  else {
      location.href = window.location.href + room;
  }
}


function sendMail()
{
  var mailID = window.prompt("Please enter guest mail id:", "harshad.sahu@quovantis.com");
  // alert (mailID);
  const data = { to: mailID };

  fetch('https://ugb5oxa6wf.execute-api.us-east-1.amazonaws.com/dev/send-email', {            
  method: 'POST', 
  headers: {
    'Access-Control-Request-Headers': '*',
    'Access-Control-Request-Method': '*',
  },
  body: JSON.stringify(data),
})
.then(response => response.json())
.then(data => {
  console.log('Success:', data);
})
.catch((error) => {
  console.error('Error:', error);
});
}


function showRooms()
{
  var docClient = new AWS.DynamoDB.DocumentClient();    
  var table = 'chat';    
  var params = {
    TableName : table,
    ProjectionExpression: "room"
  };
docClient.scan(params, function(err, data) {
    if (err) {
        console.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
    } else {
        console.log("We Get the data hurray...:", JSON.stringify(data.Items, null, 2));
        data.Items.forEach(function(chat) {
          console.log(chat.room);
          document.getElementById("mylist").innerHTML +=  " </br>" + chat.room
       });
    }
});
}
