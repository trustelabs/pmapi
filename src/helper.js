var callPMAPI = (function(myDomain, myAuthority){
	var callbacks = {};
	var my_api_listener = function (event){
		var myob = event.data;
		if(myob){
			if(typeof myob == "string"){
				myob = JSON.parse(myob);
			}
			if(myob.PrivacyManagerAPI && myob.PrivacyManagerAPI.capabilities){
				//This is a message from the PM API.
				myob = myob.PrivacyManagerAPI;
				var callback = callbacks[myob.callbackKey];
				if(callback) callback(myob);
				//else not mine
			}
		}
	};
	if (window.postMessage) {
		if (window.addEventListener) {
			window.addEventListener("message", my_api_listener, false);
		} else {
			window.attachEvent("onmessage", my_api_listener);
		}
	}
	return function callPMAPI(callback, forDomain, cookieTypes, usingAuthority, action, others){
		if(!action) action = "getConsent";
		if(!usingAuthority) usingAuthority = myAuthority;
		if(window.PrivacyManagerAPI && !others){
			//make direct call
			callback( window.PrivacyManagerAPI.callApi(action, myDomain, forDomain, usingAuthority, cookieTypes) );
		}else if(window.postMessage) {
			//make post message call
			var myob = {
					action : action,
					self   : myDomain,
					domain : forDomain,
					type   : cookieTypes,
					authority : usingAuthority,
					timestamp : new Date().getTime()
			};
			myob.callbackKey = myob.timestamp + myob.domain;
			for(var g in others) myob[g] = others[g];
			callbacks[myob.callbackKey] = callback;
			myob = {"PrivacyManagerAPI":myob};
			window.top.postMessage( JSON.stringify(myob) , "*");
		}
	};
})("my-domain.com");