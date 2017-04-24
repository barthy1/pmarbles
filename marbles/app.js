'use strict';
/* global process */
/* global __dirname */
/*******************************************************************************
 * Copyright (c) 2015 IBM Corp.
 *
 * All rights reserved.
 *
 *******************************************************************************/
var express = require('express');
var session = require('express-session');
var compression = require('compression');
var serve_static = require('serve-static');
var path = require('path');
var cookieParser = require('cookie-parser');
var http = require('http');
var app = express();
var cors = require('cors');
var async = require('async');
var fs = require('fs');
var os = require('os');
var ws = require('ws');											//websocket module 
var winston = require('winston');								//logginer module

// --- Set Our Things --- //
var logger = new (winston.Logger)({
	level: 'debug',
	transports: [
		new (winston.transports.Console)({ colorize: true }),
	]
});
var more_entropy = randStr(32);
var helper = require(__dirname + '/utils/helper.js')(process.env.creds_filename, logger);
var fcw = require('./utils/fc_wrangler/index.js')({ block_delay: helper.getBlockDelay() }, logger);
var ws_server = require('./utils/websocket_server_side.js')({ block_delay: helper.getBlockDelay() }, fcw, logger);
var host = 'localhost';
var port = helper.getMarblesPort();
var wss = {};
var enrollObj = null;
var marbles_lib = null;
process.env.marble_company = helper.getCompanyName();

// ------------- Bluemix Detection ------------- //
if (process.env.VCAP_APPLICATION) {
	host = '0.0.0.0';							//overwrite defaults
	port = process.env.PORT;
}

// --- Pathing and Module Setup --- //
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');
app.engine('.html', require('jade').__express);
app.use(compression());
app.use(cookieParser());
app.use(serve_static(path.join(__dirname, 'public')));
app.use(session({ secret: 'lostmymarbles', resave: true, saveUninitialized: true }));
app.options('*', cors());
app.use(cors());

//---------------------
// Cache Busting Hash
//---------------------
var bust_js = require('./busters_js.json');
var bust_css = require('./busters_css.json');
process.env.cachebust_js = bust_js['public/js/singlejshash'];			//i'm just making 1 hash against all js for easier jade implementation
process.env.cachebust_css = bust_css['public/css/singlecsshash'];		//i'm just making 1 hash against all css for easier jade implementation
logger.debug('cache busting hash js', process.env.cachebust_js, 'css', process.env.cachebust_css);

// ============================================================================================================================
// 													Webserver Routing
// ============================================================================================================================
app.use(function (req, res, next) {
	logger.debug('------------------------------------------ incoming request ------------------------------------------');
	logger.debug('New ' + req.method + ' request for', req.url);
	req.bag = {};																			//create object for my stuff
	req.bag.session = req.session;
	next();
});
app.use('/', require('./routes/site_router'));

// ------ Error Handling --------
app.use(function (req, res, next) {
	var err = new Error('Not Found');
	err.status = 404;
	next(err);
});
app.use(function (err, req, res, next) {														// = development error handler, print stack trace
	logger.debug('Error Handeler -', req.url);
	var errorCode = err.status || 500;
	res.status(errorCode);
	req.bag.error = { msg: err.stack, status: errorCode };
	if (req.bag.error.status == 404) req.bag.error.msg = 'Sorry, I cannot locate that file';
	res.render('template/error', { bag: req.bag });
});


// ============================================================================================================================
// 														Launch Webserver
// ============================================================================================================================
var server = http.createServer(app).listen(port, function () { });
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
process.env.NODE_ENV = 'production';
server.timeout = 240000;																							// Ta-da.
console.log('------------------------------------------ Server Up - ' + host + ':' + port + ' ------------------------------------------');
if (process.env.PRODUCTION) logger.debug('Running using Production settings');
else logger.debug('Running using Developer settings');

if(helper.getNetworkId() === 'FakeNetworkId') {
	console.log('\n\n');
	logger.warn('----------------------------------------------------------------------');
	logger.warn('----------------------------- Hey Buddy! -----------------------------');
	logger.warn('------------------------ It looks like you did -----------------------');
	logger.error('------------------------------- not  --------------------------------');
	logger.warn('------------------------- follow my instructions ---------------------');
	logger.warn('----------------------------------------------------------------------');
	logger.warn('Your network config JSON has a network ID of "FakeNetworkID"...');
	logger.warn('You likely have other settings that are wrong too!');
	logger.warn('----------------------------------------------------------------------');
	logger.error('Fix this file: ' + helper.getNetworkCredFileName());
	logger.warn('It must have credentials/hostnames/ports/channels/etc for YOUR network');
	logger.warn('How/where would I get that info? Using the Bluemix service? Then look at these instructions(near the end): ');
	logger.warn('  https://github.com/IBM-Blockchain/marbles/blob/v3.0/docs/install_chaincode.md');
	logger.warn('----------------------------------------------------------------------');
	console.log('\n\n');
}

// ============================================================================================================================
// 														Warning
// ============================================================================================================================

// ============================================================================================================================
// 														Entering
// ============================================================================================================================

// ============================================================================================================================
// 														Work Area
// ============================================================================================================================

// -------------------------------------------------------------------
// Life Starts Here!
// -------------------------------------------------------------------
process.env.app_state = 'starting';
process.env.app_first_setup = 'yes';
setupWebSocket();

var hash = helper.getMarbleStartUpHash();
if (hash === helper.getHash()) {
	console.log('');
	console.log('');
	logger.debug('Detected that we have launched successfully before');
	logger.debug('Welcome back - Initiating start up\n\n');
	process.env.app_first_setup = 'no';
	enroll_admin(1, function (e) {
		if (e == null) {
			setup_marbles_lib();
		}
	});
}
else {
	try {
		rmdir(makeKVSpath());							//delete old kvs folder
	} catch (e) {
		logger.error('could not delete old kvs', e);
	}

	process.env.app_state = 'start_waiting';
	process.env.app_first_setup = 'yes';
	console.log('');
	logger.debug('Detected that we have NOT launched successfully yet');
	logger.debug('Open your browser to http://' + host + ':' + port + ' and login as "admin" to initiate startup\n\n');
	// we wait here for the user to go the browser, then setup_marbles_lib() will be called from WS msg
}
// -------------------------------------------------------------------

//setup marbles library and check if cc is deployed
function setup_marbles_lib() {
	logger.debug('Setup Marbles Lib...');

	var opts = helper.makeMarblesLibOptions();
	marbles_lib = require('./utils/marbles_cc_lib.js')(enrollObj, opts, fcw, logger);
	ws_server.setup(wss.broadcast);

	logger.debug('Checking if chaincode is already deployed or not');
	var options = {
		peer_urls: [helper.getPeersUrl(0)],
	};
	marbles_lib.check_if_already_deployed(options, function (not_deployed, enrollUser) {
		if (not_deployed) {										//if this is truthy we have not yet deployed.... error
			console.log('');
			logger.debug('Chaincode ID was not detected: "' + helper.getChaincodeId() + '", all stop');
			logger.debug('Open your browser to http://' + host + ':' + port + ' and login to redo/init startup');
			process.env.app_first_setup = 'yes';				//overwrite state, bad startup
			broadcast_state('no_chaincode');
		}
		else {													//else we already deployed
			console.log('\n------------------------------------------ Chaincode Found ------------------------------------------\n');
			broadcast_state('found_chaincode');

			var user_base = null;
			if (process.env.app_first_setup === 'yes') user_base = helper.getMarbleUsernames();
			create_assets(user_base); 							//builds marbles, then starts webapp
		}
	});
}

//enroll an admin with the CA for this peer/channel
function enroll_admin(attempt, cb) {
	fcw.enroll(helper.makeEnrollmentOptions(0), function (errCode, obj) {
		if (errCode != null) {
			logger.error('could not enroll...');

			// --- Try Again ---  //
			if (attempt >= 2) {
				if (cb) cb(errCode);
			} else {
				try {
					logger.warn('removing older kvs and trying to enroll again');
					rmdir(makeKVSpath());				//delete old kvs folder
					logger.warn('removed older kvs');
					enroll_admin(++attempt, cb);
				} catch (e) {
					logger.error('could not delete old kvs', e);
				}
			}
		} else {
			enrollObj = obj;
			if (cb) cb(null);
		}
	});
}

//random integer
function getRandomInt(min, max) {
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min)) + min;
}

//random string of x length
function randStr(length) {
	var text = '';
	var possible = 'abcdefghijkmnpqrstuvwxyz0123456789';
	for (var i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
	return text;
}

//real simple hash
function simple_hash(a_string) {
	var hash = 0;
	for (var i in a_string) hash ^= a_string.charCodeAt(i);
	return hash;
}

//create random marble arguments (it is not important for it to be random, just more fun)
function build_marble_options(username, company) {
	var colors = ['white', 'green', 'blue', 'purple', 'red', 'pink', 'orange', 'black', 'yellow'];
	var sizes = ['35', '16'];
	var color_index = simple_hash(more_entropy + company) % colors.length;		//build a psudeo random index to pick a color
	var size_index = getRandomInt(0, sizes.length);								//build a random size for this marble
	return {
		marble_id: randStr(24),
		color: colors[color_index],
		size: sizes[size_index],
		marble_owner: username,
		owners_company: company,
		auth_company: process.env.marble_company
	};
}

// sanitise marble owner names
function saferNames(usernames) {
	var ret = [];
	for (var i in usernames) {
		var name = usernames[i].replace(/\W+/g, '');								//names should not contain many things...
		if (name !== '') ret.push(name);
	}
	return ret;
}

//this only runs after we deploy
function create_assets(build_marbles_users) {
	build_marbles_users = saferNames(build_marbles_users);
	logger.debug('Creating marble owners and marbles');

	if (build_marbles_users && build_marbles_users.length > 0) {
		async.eachLimit(build_marbles_users, 1, function (username, user_cb) { 	//iter through each one ONLY ONE! [important]
			logger.debug('- creating marble owner: ', username, Date.now());

			// --- Create Each User, Serially --- //
			pessimistic_create_owner(0, username, function () {
				user_cb();
			});

		}, function (err) {
			logger.debug('- finished creating owners, now for marbles');
			if (err == null) {

				// --- Create Marbles, 2 Users at a Time --- //
				async.eachLimit(build_marbles_users, 2, function (username, marble_cb) { //iter through each one 

					// --- Create 2 Marbles Serially --- //
					create_marbles(username, marble_cb);

				}, function (err) {													//marble owner creation finished
					logger.debug('- finished creating assets, waiting for peer catch up');
					if (err == null) {
						all_done();													//delay for peer catch up
					}
				});
			}
		});
	}
	else {
		logger.debug('- there are no new marble owners to create');
		all_done();
	}
}

//create the owner in a loop until it exists - repeat until we see the correct error! (yes, i know)
function pessimistic_create_owner(attempt, username, cb) {
	var options = {
		peer_urls: [helper.getPeersUrl(0)],
		args: {
			marble_owner: username,
			owners_company: process.env.marble_company
		}
	};
	marbles_lib.register_owner(options, function (e) {

		// --- Does the user exist yet? --- //
		if (e && e.parsed && e.parsed.indexOf('owner already exists') >= 0) {
			console.log('');
			logger.debug('finally the user exists, this is a good thing, moving on\n\n');
			cb(null);
		}
		else {

			// -- Try again -- //
			if (attempt < 4) {
				setTimeout(function () {								//delay for peer catch up
					logger.debug('owner existance is not yet confirmed, trying again', attempt, username, Date.now());
					return pessimistic_create_owner(++attempt, username, cb);
				}, helper.getBlockDelay() + 1000 * attempt);
			}

			// -- Give Up -- //
			else {
				logger.debug('giving up on creating the user', attempt, username, Date.now());
				if (cb) return cb(e);
				else return;
			}
		}
	});
}

//create some marbles
function create_marbles(username, cb) {
	async.eachLimit([1, 2], 1, function (block_height, marble_cb) {	//create two marbles for every user
		var randOptions = build_marble_options(username, process.env.marble_company);
		console.log('');
		logger.debug('[startup] going to create marble:', randOptions);
		var options = {
			chaincode_id: helper.getChaincodeId(),
			peer_urls: [helper.getPeersUrl(0)],
			args: randOptions
		};
		marbles_lib.create_a_marble(options, function () {
			marble_cb();
		});
	}, function () {
		return cb();												//marble creation finished
	});
}

//we are done, inform the clients
function all_done() {
	console.log('\n------------------------------------------ All Done ------------------------------------------\n');
	broadcast_state('registered_owners');
	process.env.app_first_setup = 'no';

	logger.debug('hash is', helper.getHash());
	helper.write({ hash: helper.getHash() });							//write state file so we know we started before
	ws_server.check_for_updates(null);								//call the periodic task to get the state of everything
}

//message to client to communicate where we are in the start up
function build_state_msg() {
	return {
		msg: 'app_state',
		state: process.env.app_state,
		first_setup: process.env.app_first_setup
	};
}

//send to all connected clients
function broadcast_state(new_state) {
	process.env.app_state = new_state;
	wss.broadcast(build_state_msg());											//tell client our app state
}

// remove any kvs from last run
function rmdir(dir_path) {
	if (fs.existsSync(dir_path)) {
		fs.readdirSync(dir_path).forEach(function (entry) {
			var entry_path = path.join(dir_path, entry);
			if (fs.lstatSync(entry_path).isDirectory()) {
				rmdir(entry_path);
			}
			else {
				fs.unlinkSync(entry_path);
			}
		});
		fs.rmdirSync(dir_path);
	}
}

// make the path to the kvs we use
function makeKVSpath() {
	var temp = helper.makeEnrollmentOptions(0);
	return path.join(os.homedir(), '.hfc-key-store/', temp.uuid);
}

// ============================================================================================================================
// 												WebSocket Communication Madness
// ============================================================================================================================
function setupWebSocket() {
	console.log('------------------------------------------ Websocket Up ------------------------------------------');
	wss = new ws.Server({ server: server });								//start the websocket now
	wss.on('connection', function connection(ws) {
		ws.on('message', function incoming(message) {
			console.log(' ');
			console.log('-------------------------------- Incoming WS Msg --------------------------------');
			logger.debug('[ws] received ws msg:', message);
			var data = null;
			try {
				data = JSON.parse(message);
			}
			catch (e) {
				logger.debug('[ws] message error', message, e.stack);
			}
			if (data && data.type == 'setup') {
				logger.debug('[ws] setup message', data);

				//enroll admin
				if (data.configure === 'enrollment') {
					helper.write(data);										//write new config data to file
					enroll_admin(1, function (e) {
						if (e == null) {
							setup_marbles_lib();
						}
					});
				}

				//find deployed chaincode
				else if (data.configure === 'find_chaincode') {
					helper.write(data);										//write new config data to file
					enroll_admin(1, function (e) {							//re-renroll b/c we may be using new peer/order urls
						if (e == null) {
							setup_marbles_lib();
						}
					});
				}

				//register marble owners
				else if (data.configure === 'register') {
					create_assets(data.build_marble_owners);
				}
			}
			else if (data) {
				ws_server.process_msg(ws, data);							//pass the websocket msg for processing
			}
		});

		ws.on('error', function (e) { logger.debug('[ws] error', e); });
		ws.on('close', function () { logger.debug('[ws] closed'); });
		ws.send(JSON.stringify(build_state_msg()));							//tell client our app state
	});

	wss.broadcast = function broadcast(data) {								//send to all connections
		var i = 0;
		wss.clients.forEach(function each(client) {
			try {
				logger.debug('[ws] broadcasting to client', (++i), data.msg);
				client.send(JSON.stringify(data));
			}
			catch (e) {
				logger.debug('[ws] error broadcast ws', e);
			}
		});
	};
}
