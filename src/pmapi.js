window.PrivacyManagerAPI = (function() {

	//external object, containing exposed functions
	var me = {};
	
	//the singleton object, the API itself
	var args = Array.prototype.slice.call(arguments);
	var inner = {
		"defaults" : args[0],  //defaults can be passed in on API creation
    	"binfo" : args[1]  //depreciated
	};
	
	//for cases where the API is loaded as a module, not via script element.
	if(this!=window) this.inner = inner;
	
	/*
	 * This is the main container for everything in the API. 
	 * Preferences, defaults, API information. all that.
	 * Defaults passed by "init" are sent here.
	 * 
	 * capabilities - the list of available API calls
	 * consent - map which contains all preferences.
	 * domain - the domain this API applies to, if not exact host match.
	 * 			ex: host == "sub.domain.com" but API applies to "domain.com", set domain = "domain.com"
	 */
	inner.fake = {
		capabilities : [ "getConsent" ],
		default_consent : "denied",
		default_source : "implied",
        /* 
         * ALL SECURITY IN API IS RETROACTIVE: Innocent till proven guilty.
         * Therefore logs are needed to determine usage and abuse.
         * REPORT LEVELS BIT-MASK:
         * 1  : Dont report all first-party calls (sync calls)
         * 2  : Dont report all third party calls (iframe post messages)
         * 4  : Dont automatcially report all calls with declared authority
         * 8  : Dont report requests for own permission (self == domain) from first party
         * 16 : Dont report requests for own permission (from == domain) from third party
         * 32 : Dont report third parties asking from a same domain (self == from) from third party
         * 64 : Dont automatically report unauthorized authorities  (if domain == auth or from == auth, then authorized)
         * 128: Dont send errors
         * 256: ...
         */
		reportlevel : 5,
		consent : {
			all : {
				value : null,
				type : {}
			}
		},
		domain : window.location.hostname
	};
	//Callback container, for auto-responses on API change.
	inner.requestors = {"loading":[]};
	//List of authorization granters. Some calls require an entity on this list to
	//authorize a party to make. The site owner is automatically treated as an authorizer.
	inner.authorities = [ ".truste.com" ];
	//list of domains not allowed to use the API
	inner.blacklist = [".example-xxx.com"];
	/*
     * HOW THIS WORKS::
     * 		TYPES::
     * 			A type is an integer;
     * 			A type can also have a "label" or "name", which is enumerated below;
     * 			A type is comprised of 4 bits * 4; //IOW 4 hex digits
     * 			Each 4bit (hex) value represents a "level" or "score" or "answer", whatever you want to call it,
     * 			to the question represented by that value's bit's location;
     * 			Questions represented:
     * 				Bits    Question
     * 				1-4		When
     * 				5-8		Where
     * 				9-12	What
     * 				13-16	Who
     * 			Hex Value to Type Level:
     * 				Hex		Type Level (1-4)
     * 				0x1		1
     * 				0x3		2
     * 				0x7		3
     * 				0xf		4
     * 			You'll notice that the bits look like this (0001,0011,0111,1111);
     * 			That's because this is a bit mask. Each bit represents an 'answer', and each
     * 			set of 4 represents a 'question'. This fills out the 4x4 matrix of possible Types;
     * 			Each "higher" level is a superset of lower "levels"; ex. "denying" 0xF implies denying 0x7,0x3 and 0x1;
     * 			
     * 			This is done on a "bit by bit" basis (XOR). For example, b1000 will imply b1111, and
     * 			therefore "denying" b1000 implies denying b0111 and b0011 and b0001 - -
     * 			BUT BUT BUT BUT
     * 			For the sake of sanity, this API does not enforce what I just said: b1000 is not a valid Type level value
     * 			and this API, when encountering that invalid type, does not specify a behavior.
     */
    inner.valid_values = { 
    	consent:{"denied":1,"approved":2}, 
		source:{"implied":1,"asserted":2},
		type:{"session":0xFFFF1,"necessary":0xFFF3,"limited":0xFFF7,
			  "host":0xFF1F,"shared":0xFF3F,"present":0xFF7F,
			  "systemic": 0xF1FF, "functional":0xF3FF,  "unique":0xF7FF, "uuid":0xFFFF,
			  "user":0x1FFF,"site":0x3FFF, "party":0x7FFF,
			
			  "private":0x3F71, "security":0x3F13,"functionality":0x7173,
			  "preferences":0x7773, "behavioral":0x333F,"tracking":0xF37F,
			  "analytic":0x7777,"advertising":0xF7FF,"requested":0x1F77,
			  "required":0x3F33,"functionality":0x7373,"targeting":0xFFFF
		}
	};
    /**
     * caddy is just a general purpose information holder
     * on Errors, it's an information carrier back to the initial entry point
     * during a PostMessage API call, it's an information carrier (because don't want to use function arguments)
     */
    inner.caddy = null;
    
    
	/**
	 * determines if the API has/allows this API call
	 * 
	 * @param action name of the API call
	 * @returns int of the index (+1) of the action in the capabilities array.
	 * 			This is 0 if the action is not found, so you can use if(isCapable())
	 */
	inner.isCapable = function(action){
    	for (var i = this.fake.capabilities.length; i-->0;) {
            if (this.fake.capabilities[i] == action) { return i+1; }
        }
    	return 0;
    };
    /**
     * Tests where the first parameter ends with the second parameter
     * 
     * @param b test string
     * @param a postfix (the ending)
     * @returns true if b.endsWith(a);
     */
    inner.endsWith = function(b,a){
    	return (a!=null&&a.replace)?new RegExp('.*'+a.replace(/\./g,"\\.")+'$').test(b):false;
    };

	/**
	 * Applies old preferences which were stored in a previous run of this API on this domain.
	 * These preferences are DOMAIN / TYPE preferences only. The CM preferences are 
	 * separate (since the CM is not part of the PM API).
	 * 
	 * Overwrites the preferences at a DOMAIN level ("all" is a "domain" as well),
	 * this should happen before the API is activated.
	 * 
	 * @param oldfake the API preferences object
	 */
	inner._hasLoadedPrefs = false;
    inner.loadOldPrefs = function(oldfake){
    	var oldprefs = this.getStorage("PrivacyManagerAPI.preferences");
    	if(oldprefs){
    		for(var s in oldprefs){
    			oldfake.consent[s] = oldprefs[s] || oldfake.consent[s];
    		}
    	}
    	this._hasLoadedPrefs = true;
    	///////resend requests made while loading
    	var i=0,n = (inner.requestors.loading && inner.requestors.loading.length) || 0;
    	while(i<n){
    		var l = inner.requestors.loading[i++];
			inner.processMessage(l.apiOb, l);
		}
    };
    
    /**
     * Queries if this API call has the correct permissions.
     * Only certain calls need "permission".
     * 
     * Calls where the domain==from (or domain.endsWith(from) ) don't need permission
     * Searches the authorities array
     * 
     * Sends a "uka" event to the Tracker API when the authority is not any known entity on the page.
     * 
     * @param domain The domain for which permission is needed to query about
     * @param from The frame's origin from which the postMessage API call came
     * @param asker The entity making the API call
     * @param auth The declared Authority from the API call. Can be String, Array, or CSV String
     * 
     * @returns Integer If an (any) authority is in the API's Authorities list, 
     * 						the value is >0 (the index of that authority in the list)
     * 					Else if any Authority is == "from", then -3
     * 					Else if any Authority is == "domain", then -2
     * 					Else if any Authority is == window.location, then -1
     * 					Else 0
     * 
     */
    inner.isAuthorized = function(domain,from,asker,auth){
    	if(!auth) return 0;
    	auth.charAt && (auth = auth.split(/\s*,\s*/));
    	var g, result = 0, home = '.' + window.location.hostname;
    	from = from || home;
    	
    	for(var j = this.blacklist.length; j-- > 0;){
			var black = this.blacklist[j];
    		if(this.endsWith(from,black)) return 0;
    	}
    	
		for(var j = auth.length; j-- > 0;){
			var aj = auth[j];
			if(aj.charAt(0)!=".") aj = auth[j] = "." + aj;
    		for(var i = this.authorities.length; i-- > 0 ;){
    			g = this.authorities[i];
    			if(this.endsWith(aj,g)) return i+1;
    		}
    		if(this.endsWith(from,aj)) result = Math.min(-3,result);
    		else if(this.endsWith(domain,aj)) result = Math.min(-2,result);
    		else if(this.endsWith(home,aj)) result = Math.min(-1,result);
    		
    	}
		if(result) return result;
    	if(!domain || !asker) return 0;
    	
    	//unlisted authority
    	this.sendEvent("uka",auth,0,asker,null,domain,from);
    	return 0;
    };
    
    /**
     * The auto-respose function. Takes the stored previous API calls and
     * remakes the call, diffs the output, and if different, resends the response.
     * 
     * Since the API calls only get responded to (and therefore stored) if they have
     * propper authority, no authority check (or event sending) is needed here.
     * 
     * @param sendto Object containing the old API calls
     * @param includeDecision boolean whether to repond to old GetConsentDecision API calls too
     * @param ts timestamp to add to all the API responses that get sent out
     * 
     */
    inner.sendUpdatesTo = function(sendto, includeDecision, ts){
    	this.caddy = {"hold":true};
    	var e2,list,
    	_ob2 = {  PrivacyManagerAPI:{
            			timestamp:ts,
            			capabilities : this.fake.capabilities 
            	}}, 
        papi = _ob2.PrivacyManagerAPI;
    	
        for(var domain in sendto){
        	if(list = sendto[domain]) for(var i=list.length; i-- >0;){
                if((e2=list[i]) && e2.w){
                	if(e2["getConsent"]){
                		var it = this.apiDo("getConsent", this.authorities[0], e2.d, this.authorities[0], e2.t);
                        if(e2.s!=it.source || e2.c!=it.consent){
                        	papi.consent = e2.c = it.consent;
                        	papi.source = e2.s = it.source;
                        	papi.self = e2.a;
                        	papi.domain = e2.d;
                        	papi.action = "getConsent";
                            this.sendPost(e2.w,_ob2);
                        }
                	}else if(e2["getConsentDecision"] && includeDecision){
                		papi.consent = papi.source = null;
                		papi.self = e2.a;
                		papi.action = "getConsentDecision";
                		this.sendPost(e2.w,_ob2);
                	}
                }
            }
        }
        this.caddy = null;
    };
    /**
     * Converts the "type" string (or array of strings) to a single integer value
     * 
     * @param type String or String[] or CSV String (technically, and non-word character separated list)
     * @returns integer Integer type equivalent to the initial "type" parameter
    */
    inner.getBType = function(type){
    	var resp = 0xFFFF;
    	if(type){
    		//convert to array
    		if(type.charAt){
    			type = type.split(/\W+/);
    		}else if(type > 0) type = [type];
    		//process each
	    	for(var j = type.length; j-- > 0;){
	    		var t = parseInt(type[j]);
	    		if(isNaN(t)){
	    			if(this.valid_values.type[type[j]]){
	    				resp &= this.valid_values.type[type[j]];
	    			}else{
	    				throw new Error("invalid type");
	    			}
	    		} else{
	    			resp &= t;
	    		}
	    	}
    	}
    	return resp;
    };
    /**
     * Gets the permission for a Type given the rules in a Type Object.
     * Goes through the typeOb, and at each type, check is the current "type" is a subset of any of them.
     * The Keys, if you recall, can be CSV, so you can have {"site security required":"approved"} as your typeOb
     * 
     * @param typeOb Object key-value map. Key is type name (or integer) and value is a valid consent value
     * @param type Integer or String type, or array of integers and string types. This represents the type
     * 			from the current query.
     * @return String a Consent Value
     */
    inner.getTypePermission = function(typeOb, type){
    	if(!type||isNaN(type)||type.length) type = this.getBType(type);
    	var resp = [];
    	if(type!=0){
	    	//typeOb = { "type_name":"approved", type_int:"denied"}
    		for(var key in typeOb){
	    		if(typeOb[key] && this.valid_values.consent[typeOb[key]]){
	    			resp.temp = this.getBType(key);
	    			if((resp.temp | type) == resp.temp ){
	    				if(!resp[typeOb[key]]) resp.push(typeOb[key]);
	    				resp[typeOb[key]] = key;
	    			}
	    		}
	    	}
    	}
    	if(resp.denied) return "denied";
    	else return resp.join(",");
    };
    
    /**
     * Takes new preferences for a domain and sets them on the API preferences object.
     * Also stores them in localStorage.
     * 
     * @param domain String The domain of the preference
     * @param value String Consent Value to be used as the "domain"s default value
     * @param types Object {"some type":"some consent value",...} Type preferences
     * @param fakeOb Object The API's preferences object
     */
    inner.updatePreferences = function(domain,value,types,fakeOb){
    	if(!domain) return false;
    	domain.charAt(0)!='.' && (domain='.'+domain);
    	if(value || types){
            var g = this.getConsentForDomain(domain,fakeOb) || {type:{}};
            if(this.valid_values.consent[value]) g.value = value;
            if(types) for(var s in types){
            	if(this.valid_values.consent[types[s]]){
	            	if(isNaN(s)){
	            		if(this.valid_values.type[s]) g.type[s] = types[s];
	            	}else{
	            		g.type[s] = types[s];
	            	}
            	}else if(types[s]===null || types[s]==="null"){
            		g.type[s] = null;
                    delete g.type[s];
                }
            }
            fakeOb.consent[domain] = g;
        }else if(value===null || value==="null"){
        	fakeOb.consent[domain] = null;
            delete fakeOb.consent[domain];
        }else return false;
    	this.getStorage("PrivacyManagerAPI.preferences",fakeOb.consent);
        return true;
    };

	// ////////////////////END UTILITY FUNCTIONS///////////////////////

    /**
     * MAIN API CALL
     * This is the one that actually does everything
     */
    inner.apiDo = function(action, asker){
        if(!action || !asker || !this.isCapable(action)) return {error:"Call is missing required parameters or not allowed"};
        switch(action){
            case "getConsent" :
            	var auth = arguments[3] || window.location.hostname;
            	var domain = arguments[2] || window.location.hostname;
            	domain && domain.charAt(0)!='.' && (domain='.'+domain);
            	var authr = isNaN(auth)?this.isAuthorized(domain,(this.caddy||{}).from,asker,auth):auth;
            	if(domain=='all') return {error:"Call is not authorized"};
            	
            	var type = 0;
                try{
                	type = this.getBType(arguments[4]);
                }catch(e){
                	 return {error:"Invalid Type parameter"};
                }
                var it = this.getConsentForDomain(domain,this.fake);
                var result = this.getTypePermission(this.fake.consent.all.type, type) || this.fake.consent.all.value;
                if(it){
                    result = this.getTypePermission(it.type, type) || it.value || result;
                }
                //the idea is that the second argument is a string if it needs to be reported as a 'declared' authority
                this.sendEvent(action, authr?authr:auth , type, asker, this.caddy, domain);
                it = result ? {source:"asserted",consent:result} : {"source":this.fake.default_source,"consent":this.fake.default_consent};
                if(authr>0) it.origin = window.location.hostname;
                return it;
            default: return this.secondaryAction(action, asker,arguments[2]);
        }
    };
    /**
     * Processes all API PostMessage calls. Call has already been vetted as a valid API call.
     * Since these calls can require authorization, that check is done here.
     */
    inner.processMessage = function(apiOb,e){
    	var v, from;
		if (!apiOb || !e || !(from = e.origin || e.domain))
			return null;
		apiOb.capabilities = this.fake.capabilities;
		this.tconsole.log("processing message from " + from);
    	
        e = {"origin": e.origin,"domain": e.domain,"source": e.source};
        
        if(from=="null" || from=="") from = window.location.hostname;
        if((v = from.indexOf("://"))>0) from = from.substring(v+3);
        if((v = from.indexOf(':'))>0) from = from.substring(0,v);
        from = '.'+from;
        
        switch(apiOb.action){
        	case "getConsent" :
        		var asker, auth, domain, nt = apiOb.type || undefined;
                //if(nt && !valid_values.type[nt]) return {error:"Invalid Type parameter"};
                (asker = apiOb.self)    && asker.charAt(0)!='.'  && (asker='.'+asker);
                (domain = apiOb.domain) && domain.charAt(0)!='.' && (domain='.'+domain);
                auth = apiOb.authority;
                
                if(domain && !this.endsWith(domain,from)){ 
                	//not asking about yourself, need authority
                	if(!auth || !asker || (auth = this.isAuthorized(domain,from,asker,auth) <= 0)){
                		//invalid authority
                		return {error:"Call is not authorized"};
                	}
                }else{ 
                	//asking about self, so don't need authority
                	//enter in come convienence values
                	if(!domain) domain = from;
                	if(!auth) auth = domain;
                }
                this.caddy = {"from":from}; //set caddy so apiDo can tell it's a 3rd party call
                var resp = this.apiDo("getConsent",asker,domain,auth,nt);
                this.caddy = null;
                if(resp && !resp.error){
                	//store the response for auto-responding later when changes are made
                	this.requestors[domain] = this.requestors[domain] || [];
                	this.requestors[domain].push({w:e,"getConsent":1,t:nt,a:asker,d:domain,s:resp.source,c:resp.consent});
                	resp.domain = domain;
                	resp.self = asker;
                }
                return resp;
        	case "updatePreference" :
                if(this.isAuthorized(null,null,null,from)>0){
                    var forDomain = apiOb.domain;
                    if(!forDomain){
                        return {error:"Required parameter 'domain' not sent"};
                    }
                    forDomain.charAt(0)!='.' && (forDomain='.'+forDomain);
                    var newValue = apiOb.value;
                    var forTypes = apiOb.type;
                    
                    /////WRITE NEW VALUES//////
                    if(!this.updatePreferences(forDomain,newValue,forTypes,this.fake)) return {error: "Invalid value for required parameter 'value' sent"};
                    /////SEND UPDATE TO LISTENERS//////
                    var sendto = this.requestors;
                    if(forDomain!="all"){
                    	sendto = {};
                    	sendto[forDomain] = this.requestors[forDomain];
                    }
                    this.sendUpdatesTo(sendto,false,apiOb.timestamp);
                    return null;
                }else return {error:"Call is not from an authorized Location"};
        	 default: return this.secondaryMessageProcessing(apiOb,e,from);
        }
    };
    
	/**
	 * 
	 * Calculates the consent value for a particular domain.
	 * Does not consider defaults, this is "domain" only.
	 * 
	 * 
	 * @param domain the domain for the preference you're looking for
	 * @param fakeOb The API preferences object
	 * 
	 * @returns Object {value:"some consent value",type:{"some type":"some consent value"}};
	 */
	inner.getConsentForDomain = function(domain, fakeOb){
    	if(!domain || !fakeOb) return null;
    	var temp = fakeOb.consent[domain] || null;
    	return temp;
    };
    //placeholder
    inner.handleCMMessage = function(ob){ 
    	return null; 
    };

	
    
    /**
     * This is to report events to a server. This is VERY important to the API because all
     * security is post-action security. At run time, the action is allowed, but a report is
     * sent. Reports are analyzed for incorrect behavior, and if found, action can later be 
     * taken to prevent the domain responsible from calling the API.
     * 
     * Existence of "caddy" indicates that this is a third party call
     * caddy.hold is manually set by another internal API function meaning to NOT send events
     * if "authr" is a number, then don't need to force a report because entity is already known/approved
     * 
     * @param action The action param of the API call
     * @param authr The processed authorization value of the call. If this is a known authorizer, then it's a number.
     * @param type The binary type param of the API call
     * @param asker The claimed identity of the caller
     * @param info specific information which is included with the call. is reported raw to service.
     * @param domain The domain for which this manager is hosted
     */
    inner._imgrep = [];//so the img isn't garbage collected
    inner.sendEvent = function(action, authr, type, asker, info, domain){
    	if(this.caddy && this.caddy.hold) return;
    	if(window.location.protocol != "http:" || this.tconsole.isDebug()) return;
    	if(info==null) info = {"page":window.location.pathname};
    	
    	var mydomain = window.location.hostname, 
    		q = "?a="+encodeURIComponent(authr)+
    			(type?("&t="+encodeURIComponent(type)):"")+
    			"&u="+encodeURIComponent(asker)+
    			(info?"&n="+encodeURIComponent(this.cheapJSON(info)):"");
    	if(inner.fake.domain)
    		mydomain = inner.fake.domain;
    	if(inner.fake.locale)
    		q += "&l="+encodeURIComponent(inner.fake.locale);

    	this._imgrep[this._imgrep.push(new Image(1,1))-1].src = 
    		'//trackerapi.truste.com/trackerapi/1.0/log/cma/'+mydomain+'/'+action+q+"&ts="+new Date().getTime();
    };
    
    /**
     * The only exposed JS function. All direct API calls (first party) come through here.
     * Just forwards the function call to apiDo()
     */
    me.callApi = function(){
        try{
        	inner.caddy = null;
        	return inner.apiDo.apply(inner,arguments);
        }catch(e){  
        	inner.tconsole.log(e.stack);
        	return {error:"Unknown Error occured"}; 
        }
    };
	/**
	 * Handles errors which occured in what were supposed to be "valid" API postMessage calls.
	 * 
	 * @param e Error object
	 * @param event The PostMessage Event object
	 */
	inner.handleMessageError = function(e,event){
		this.tconsole.log("Privacy Manager API unknown error. Returning Error. "+e.toString());
    	this.tconsole.log(event);
        var rob = {PrivacyManagerAPI:{error:"An unknown error occurred: "+e.toString()}};
        this.sendPost(event,rob);
        if(window.console){ console.log(e.stack); } else throw e;
	};	/**
	 * Debug output printer
	 * Checks for debug flag on API object and existence of a "console".
	 */
	inner.tconsole = {
		isDebug : function(){
			return (window.PrivacyManagerAPI||me).debug || window.location.hostname.indexOf(".") < 0;
		},
		log : function(msg) {
			inner.tconsole.isDebug() && window.console && window.console.log(msg);
		}
	};
	/**
	 * Gets an object from a JSON string;
	 * Uses JSON if the browser has it;
	 * Else uses safe eval I found on the internet: //TODO find link
	 * 
	 * @param text JSON string
	 * @returns object from the JSON
	 */
	inner.parseJSON = function(text) {
		if(typeof text != "string") return text;
		try {
			return window.JSON ? JSON.parse(text)
					: (!(/[^,:{}\[\]0-9.\-+Eaeflnr-u \n\r\t]/.test(text.replace(/"(\\.|[^"\\])*"/g, ''))) && eval('(' + text + ')'));
		} catch (e) {}
		return null;
	};
	
	//tries to find a JSON parser
	inner.cheapJSON = function(o) {
		return window.JSON ? JSON.stringify(o)
				: (truste.util&&truste.util.fromJSON ? truste.util.getJSON(o) : "{\"PrivacyManagerAPI\":{\"message\":\"The API needs a JSON parser\"}}");
	};
	
	
    /**
     * Getter/Setter
     * 
     * Getter [value==null] ('undefined' will pass)
     *   Looks in localStorage first. 
     *   If !null && !"", then parses the JSON and returns;
     *   Looks in the cookiejar.
     *   If !null && !"", then parses the JSON;
     *   If localStorage exists,
     *   	writes the value to localStorage (for case where subdomain has changed) and returns
     *   returns null
     *   
     * Setter [value != null]
     *   stringifies if ! string
     *   If value == "", deletes entry from localStorage
     *   Else writes the string to LS
     *   If value == "", expires cookie from cookiejar
     *   Else writes the string to a cookie expiring ~a year from now
     *   
     * @param name The Key for lookup
     * @param value [optional] determines whether getter or setter; behavior above.
     * @returns Object from storage or NULL if not found;
     */
	inner.getStorage = function(name, value) {
		try {
			if (value != null) {
				if (!value.charAt) {
					value = this.cheapJSON(value);
				}
			}
			if (window.localStorage) {
				try {
					if (value == null) {
						value = window.localStorage[name]
								|| window.localStorage.getItem(name);
						if (value)
							return (this.parseJSON(value) || value);
						value = null;
					} else {
						if (value) {
							window.localStorage.setItem(name, value);
						} else {
							delete window.localStorage[name];
						}
					}
				} catch (e) {
					this.tconsole.log("said was localstorage but wasn't: " + e.stack);
				}
			}
			var rx;
			if (value == null) {
				rx = new RegExp("\\s*" + name.replace(".", "\\.") + "\\s*=\\s*([^,;\\s]*)").exec(document.cookie);
				if (rx && rx.length > 1) {
					value = decodeURIComponent(rx[1]);
					if (value && window.localStorage) {
						try {
							window.localStorage.setItem(name, value);
						} catch (e) {
							this.tconsole.log("said was localstorage but wasn't: " + e.stack);
						}
					}
					return (this.parseJSON(value) || value);
				}
			} else {
				var d = this.fake.domain || null;
				if (d && d.slice(0, 1) != ".")
					d = "." + d;
				var exp = "; expires=" + (value ? ((rx = new Date()) && rx.setDate(720) && rx.toGMTString()) : "Thu, 01 Jan 1970 00:00:01 GMT");
				exp += "; path=/" + (d ? "; domain=" + d : "");
				document.cookie = name + "=" + encodeURIComponent(value) + exp;
			}
		} catch (e) {
			this.tconsole.log("error with getStorage : " + e.stack);
		}
		return null;
	};

    /**
     * Convenience PostMessage sending utility function
     * 
     * @param e the received postMessage object containing the "source" and "origin"
     * @param rob the data to be sent, Object or String
     */
	inner.sendPost = function(e, rob) {
		if (!window.postMessage || !e || !e.source || !rob)
			return;
		if (typeof rob == "object") {
			rob = this.cheapJSON(rob);
		}
		var from = e.origin || e.domain;
		if (from == "null" || !from)
			from = "*";
		this.tconsole.log("responding to (" + from + ") message : " + rob);
		if (rob)
			e.source.postMessage(rob, from);
	};
	
	/**
	 * Internal Use
	 * 
     * Applies default settings of the site.
     * User settings override site default settings if ever there is a conflict, which
     * means that this CAN NEVER run after loadOldPrefs() - which is why the _hasLoadedPrefs variable exists.
     * 
     * @param _fake the default preferences object hard coded into the API
     * @param defaults the "default" parameter passed into the function which creates the API.
     * 			  This is actually the default parameters as customized by the site owner in their Portal bindings.
     */
	inner.init = function(defaults, _fake, loadOldPrefs) {
    	if(this._hasLoadedPrefs) return;
		_fake = _fake || this.fake;
		try {
			if (defaults && typeof defaults == "string") {
				defaults = this.parseJSON(defaults);
			}
			if (defaults) {
				for ( var s in _fake) {
					_fake[s] = defaults[s] || _fake[s];
				}
			}
			if(loadOldPrefs && inner.loadOldPrefs) this.loadOldPrefs(_fake);
		} catch (e) {
			this.tconsole.log(e);
		}
	};
	/**
	 * PostMessage listener. This is the entry for third party calls. It does basic
	 * validation checking for a correctly name-spaced object.
	 * 
	 * Checks to see if the message is for the API.
	 * Checks to see if the message is (mostly) valid.
	 * Sometimes messages are sent from the API to the same frame as the API, 
	 * so this listener must know to ignore messages from itself.
	 * 
	 * @param e The message even from the browser
	 */
	inner.messageListener = function(e) {
		var ob, dob = e.data && inner.parseJSON(e.data);
		if (!dob || !(ob = dob.PrivacyManagerAPI || inner.handleCMMessage(dob) ))
			return; 
		if (ob.capabilities || ob.error) {
			inner.tconsole.log("got my own message, returning");
			inner.tconsole.log(e);
			return;
		}
		if (!ob.timestamp || !ob.action) {
			var rob = "{\"PrivacyManagerAPI\":{\"error\":\"API Object missing required fields\"}}";
			inner.sendPost(e, rob);
			return;
		}
		try{
			inner.tconsole.log("GOT VALID MESSAGE: "+e.data);
			var resp = inner.processMessage(ob, e);
			if (resp) {
				for ( var s in resp)
					ob[s] = resp[s];
				if(dob.PrivacyManagerAPI) inner.sendPost(e, dob);
			}
		}catch(error){
			inner.handleMessageError(error,e);
		}
	};
	/**
	 * External Use
	 * 
	 * Applies defaults to the API. These defaults will be used when the user has no settings for
	 * queried domains or types. Generally this is used by domain owners (first parties).
	 * 
	 * @param defaults Object which contains key-value pairs to be applied as the defaults of the API.
	 * @param finalizeIt boolean which instructs the API to finalize (no longer accept new defaults).
	 */
	me.init = function(defaults,finalizeIt){
		inner.init(defaults,null,finalizeIt);
	};
	window["PREF_MGR_API_DEBUG"] = inner;	
	if (window.postMessage) {
		if (window.top.addEventListener) {
			window.top.addEventListener("message", inner.messageListener, false);
		} else {
			window.top.attachEvent("onmessage", inner.messageListener);
		}
	}
	inner.init(inner.defaults);
	return me;
})();
