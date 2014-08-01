Privacy Manager API
=====


The purpose of this API is to facilitate distribution of user privacy preferences set through a website privacy preferences manager to all parties on a web page, so that these outside parties may honor the user's preferences. This document is to describe an overview of the design of this API as well as a light technical overview of the technologies involved. 

The scope of each instance of the API is the first party domain, including subdomain, on which it resides, but callers should not assume preferences to be persistent across session or even page loads. At this time, the preferences in the API pertain to any (non asset) information stored on a client machine, collectively referred to in this document as a 'cookie'.


## Basic Mechanism

This API's main function is to provide user privacy preferences to all parties. Two different methods are used, depending on the location of the party on the web page, to retrieve this information. First party scripts are those that are loaded into the first party web page (DOM), and these parties can use a straight-forward function call, with the appropriate parameters, to retrieve API information. Interface into the API exists as one function for these parties, and the API blocks access to itself using any other means. This first party interface exists of only "getters", or calls to retrieve information.

The communication mechanism to be used by third parties (scripts/pages loaded within IFrames) is "message passing". Details of this are to be described later in this document, but basically a "message" is sent from the third party to API, the API then sends a response message. An analogy for message passing for non-technical individuals would be school room note passing amongst students. What can be communicated is limited to text, the message can sometimes take a "long time" to reach its destination, and the message itself can be intercepted by anyone who happens to be sitting between the recipient and sender - the only difference being that message passing is assured to reach it's destination. This mechanism is not used by choice, obviously it has many drawbacks over simple function calls, however this is the ONLY technique available in HTML to communicate between different parties located on the same web page.


## Further Details

###First Party - Function call
- The first party function call is a one time, synchronous event. When permissions are changed within the mechanism of the API, no notification or update is sent. Therefore whenever a first party needs the current user settings, the call must be made again. First party scripts also have the ability to ask for permission for ANY domain, whereas a third party (message passing) can only ask for it's own permission*.

###Third Party - Message Passing
- Message passing is asynchronous, meaning that there is no guarantee how long it will take. Realistically, one can expect a roundtrip of calls to take 1-10ms, in some cases with multiple page loads, this can be delayed to 50ms, and it's even possible on poorly designed pages to delay this several seconds. In this way, when loading something time dependent, a third party must implement a timeout mechanism to keep from waiting too long for a response. The recommended timeout delay is 100ms, but all API callers are encouraged to wait as long as possible. Third party API callers can only ask about user permission for their own domains*, "their own domain" being the window.location.hostname of the page (DOM) on which they are located. However, all parties which use message passing are automatically registered to receive updates when users change their preference. For this reason, it may be beneficial for first parties to use message passing as well.

*unless otherwise authorized to do so


API Call Technical Information
=====

All API objects will be returned with an array of API calls ('action' parameters) that the Privacy Manager can accept, as a field named "capabilities". This field will not be mentioned in the document call specs below, as it's in all calls. This has the dual function of providing version control and allowing for abstract implementations of this API, should a publisher not wish to support all calls.

### Function Call

All calls to the API are made through this function : `PrivacyManagerAPI.callApi(callName, arg1, ...)` The first parameter passed is the call name. Subsequent parameters sent are the ones required by the call, in the order expressed in this document. An object is returned, containing only the field names specified below for each call, labeled 'returns'.

### Message Passing
All messages to the API must be JSON strings consisting of a root object with a property/field named "PrivacyManagerAPI", which references an object, referred to as the "api object". All api objects must have these properties:
- "timestamp" - the `new Date().getTime()` the message is sent
- "action" - the name of the api call
- "self" - who you are: your domain or a domain by which you wish to be identified.
All API call parameters will be added onto this api object. This object will be returned from the API, not the exact object but a copy of it, so any non-API properties added to this object (ex. a UID, or callbackID) will be retained. 

## Current Calls

### getConsent
Gets the user's cookie consent for the domain passed. This preference has two levels, a typed and a non-typed general case. The general case value will be returned when a type is not specified in the call, or if there is no preference for the type requested.
##### _parameters: 1-4_
- _self_ - Identifying yourself, as the API caller, in an unambiguous manner, such as a domain name.
- _domain_ [optional] - the name of the domain for which the current consent preference is requested. For message passing, this domain can be derived from the message object, therefore is optional as a parameter, but if you are requesting for some different domain, keep in mind that you must pass a valid authority in the "authority" field. If left blank for synchronous call, then assumed to be the window.location.hostname.
- _authority_ [optional] - The name, or domain name, of the source from which the API caller derives permission to make the call. Required only for iFrame calls where 'domain' is not the same as the iframe's host. Authorities are generally Preference Manager implementors, such as TRUSTe, who are trusted to maintain the integrity of this API.
- _type_ [optional] -  indicates the purpose/type of the cookie for which permission is being requested. Accepted values TBD.

##### _returns: 2_
- _consent_ - the value of the current user permission. see below for values.
- _source_ - the source of the current permission. see below for values.

##### example synchronous calls: 
- `PrivacyManagerAPI.callApi("getConsent", "my.domain.com", "www.myexample.com");`
- `PrivacyManagerAPI.callApi("getConsent","my.domain.com", "www.myexample.com","authority.com", "session");`

##### example object returned:
- `{source: "implied", consent: "denied"}`

##### example api objects for post message calls: 
- `{timestamp:new Date().getTime(), action:"getConsent", self:"my.domain.com"}`
- `{timestamp:new Date().getTime(), action:"getConsent", self:"my.domain.com", domain:"otherdomain.com", authority:"authority.com", type:"session"}`

##### example API object response to post message call: 
- `{capabilites:["getConsent"], source:"implied", consent:"denied", action:"getConsent", timestamp:1234567890, self:"my.domain.com"}`


####  
### updatePreference

Updates the user's cookie consent value for the domain passed. This call is ONLY exposed via Message Passing (first parties must use message passing too). ONLY WHITELISTED DOMAINS CAN SET THIS VALUE. Whitelists are set by the API's client (web page operator).

##### _parameters: 2-3_

- _domain_ - the name of the domain for which the current consent preference is being updated. A value of "all" sets the new value as the default for domains which do not have individual preferences.
- _value_ - the new general case Consent value of the preference. Valid values are listed below. Passing a value of null or "null" removes all preferences for that domain.
- _type_ [optional] - object, with field names of cookie types, the field value being the new Consent value for that type. These values will supersede the general case for their respective types.

##### example api object:
```javascript
{timestamp:new Date().getTime(), action:"updatePreference", domain:"www.example.com", value:"denied", type:{session:"approved",personal:"approved"}, self:"my.domain.com"}
```



## API Terms
- _"approved"_ - The Consent value which indicates that according to the the privacy manager of this web page, the party is allowed to set cookies.
- _"denied"_ - The Consent value which indicates that according to the the privacy manager of this web page, the party is not allowed to set cookies.
- _"implied"_ - The Source value which indicates that the Consent value was not set by a user action, or something equivalent. This could indicate that the Consent value is a website default, that the user is in a location that requires a certain Consent value, or some other privacy setting indicates a certain value be set.
- _"asserted"_ - The Source value which indicates that the Consent value was set by user action, or something equivalent.
