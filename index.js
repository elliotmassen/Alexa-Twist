var express = require("express"),
	alexa = require("alexa-app"),
	request = require("request"),
	fetch = require("node-fetch")
	moment = require("moment"),
	oauthToken = require("./oauth-token")
	app = express(),
	// Setup the alexa app and attach it to express before anything else.
	alexaApp = new alexa.app("alexaTwist");

var workspaceId;

require("moment/locale/ca");
moment.locale("ca");

if('undefined' === typeof process.env.DEBUG) {
	alexa.appId = '...';
}

let getInboxUpdateIntent = function(request, response) {
	return getAccessToken().then(function(accessToken) {
		if(!accessToken) {
			response.say("I couldn't access your Twist account");
			return response.fail();
		}
		else {
			return getCurrentWorkspace(accessToken)
			.then(function(workspace) {
				return getInboxData(accessToken, workspace);
			})
			.then(function(inboxData) {
				return inboxData.json();
			})
			.then(function(inboxData) {
				return parseInboxDataToSpeech(inboxData);
			})
			.then(function(sayInboxData) {
				response.say(sayInboxData);
				return response.send();
			})
			.catch(function(error) {
				console.log("getInboxUpdateIntent error:", error);
			});
		}
	});
};

let changeWorkspaceIntent = function(request, response) {
	return getAccessToken().then(function(accessToken) {
		if(!accessToken) {
			response.say("I couldn't access your Twist account");
			return response.fail();
		}
		else {
			return findWorkspace(accessToken, request.data.request.intent.slots.NEW_WORKSPACE.value)
			.then(function(data) {
				if(data == "") {
					return Promise.reject();
				}
				else if(typeof data == "object") {
					return data.workspace_id;
				}
				else {
					return data;
				}
			})
			.then(function(workspace) {
				return changeWorkspace(workspace);
			})
			.then(function(workspace) {
				response.say("Workspace changed!").shouldEndSession(false);
				return response.send();
			})
			.catch(function(error) {
				response.say("I'm sorry, I can't change to that workspace right now.");
				console.log("changeWorkspaceIntent error:", error);
			});
		}
	});
};

alexaApp.launch(getInboxUpdateIntent);
 
/*
	GET INBOX UPDATE
*/
alexaApp.intent("getInboxUpdate", {
	"slots": [],
	"utterances": [
		"what's in my inbox"
	]},
	getInboxUpdateIntent
);

/*
	CHANGE WORKSPACE
*/
alexaApp.intent("changeWorkspace", {
	"slots": [{
		"name": "NEW_WORKSPACE",
		"type": "AMAZON.LITERAL"
	}],
	"utterances": [
		"change workspace to {NEW_WORKSPACE}"
	]},
	changeWorkspaceIntent
);


let getAccessToken = function() {
	return new Promise(function(resolve) {
		resolve("Bearer " + oauthToken);
	});
};
 
let getInboxData = function(accessToken, workspace) {
	return fetch("https://api.twistapp.com/api/v2/inbox/get?workspace_id=" + workspace, {
		"headers": {
     		"Authorization": accessToken
     	}
	});
};

let getUserById = function(userId) {
	return getAccessToken()
	.then(function(accessToken) {
		return fetch("https://twistapp.com/api/v2/users/getone?id=" + userId, {
			"headers": {
	     		"Authorization": accessToken
	     	}
		})
	})
	.then(function(data) {
		return data.json();
	})
	.then(function(data) {
		return data.short_name;
	})
	.catch(function(error) {
		console.log(error)
	});
};

let getChannelById = function(channelId) {
	return getAccessToken()
	.then(function(accessToken) {
		return fetch("https://twistapp.com/api/v2/channels/getone?id=" + channelId, {
			"headers": {
	     		"Authorization": accessToken
	     	}
		})
	})
	.then(function(data) {
		return data.json();
	})
	.then(function(data) {
		return data.name;
	})
	.catch(function(error) {
		console.log(error)
	});
};
 
let parseInboxDataToSpeech = function(inboxData) {
	return new Promise(function(resolve) {
		if(inboxData instanceof Array) {
			inboxData = inboxData.map(function(data) {
				return new Promise(function(resolve) {
					Promise.all([getUserById(data.snippet_creator), getChannelById(data.channel_id)])
					.then(function(values) {
						let author = values[0];
						let channel = values[1];

						let humanTime = moment(data.last_updated_ts, "X").locale("en-gb");
						resolve({
							"snippet": data.snippet,
							"humanTime": humanTime.fromNow(),
							"author": author.split(" ")[0],
							"channel": channel
						});
					})
					.catch(function(error) {
						console.log(error);
					});
				});
			});

			Promise.all(inboxData)
			.then(function(inboxData) {
				let updates = inboxData.map(function(data) {
					return "<break time='1s'/>Posted " + data.humanTime + " by " + data.author + " in " + data.channel + ": " + data.snippet
				});

				if(updates.length > 0) {
					resolve("Okay, here's your Twist update. " + updates.join());	
				}
				else {
					resolve("There are no new updates at the moment.");	
				}
			})
			.catch(function(error) {
				console.log(error);
			});
		}
		else {
			resolve("Sorry! I can't get your inbox update right now.");
		}
	});
};

let getCurrentWorkspace = function(accessToken) {
	return new Promise(function(resolve) {
		if(workspaceId == undefined) {
			fetch("https://twistapp.com/api/v2/workspaces/get_default", {
				"headers": {
		     		"Authorization": accessToken
		     	}
			})
			.then(function(data) {
				return data.json();
			})
			.then(function(data) {
				workspaceId = data.id;
				resolve(data.id)
			});
		}
		else {
			resolve(workspaceId);
		}
	});
};

let findWorkspace = function(accessToken, workspaceName) {
	return fetch("https://twistapp.com/api/v2/workspaces/get", {
		"headers": {
			"Authorization": accessToken
		}
	})
	.then(function(data) {
		return data.json();
	})
	.then(function(data) {
		let filteredWorkspaces = data.filter(function(workspace) {
			return workspace.name.toLowerCase().trim().split(/[\s-_!?*\']/).join("") == workspaceName.toLowerCase().trim().split(/[\s-_!?*\']/).join("");
		});

		if(filteredWorkspaces.length > 0) {
			return filteredWorkspaces[0]["id"];
		}
		else {
			return "";
		}
	});
};

let changeWorkspace = function(newWorkspaceId) {
	return new Promise(function(resolve) {
		workspaceId = newWorkspaceId;
		resolve(newWorkspaceId);
	});
};
 
// connect the alexa-app to AWS Lambda
exports.handler = alexaApp.lambda();