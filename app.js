var express = require('express');
var request = require('request');
var MiningRigRentalsAPI = require('miningrigrentals-api');
var app = express();

// Set the default calculations
var calculations = {
	'pool_max_margin': 20,
	'pool_hashrate': 0,
	'fbd_networkhashps': 0,		
	'MiningRigRentals_last10': 0,
	'fmd_weighted_btc': 0,
	'fmd_weighted_usd': 0,
	'flo_spotcost_btc': 0,
	'flo_spotcost_usd': 0,
	'pool_influence': 0,
	'pool_influence_code': -1,
	'pool_influence_multiplier': -1,
	'market_conditions': 0,
	'market_conditions_code': -1,
	'market_conditions_multiplier': -1,
	'pool_margin': 0,				   
	'offer_btc': 0
}

var config = {
	'weekly_budget_btc': 0.01,
	'min_margin': 0,
	'RPI_threshold': 80,
	'rental_length_hrs': 6,
	'api_key': 'password',
}

app.get('/', function (req, res) {
  	res.send('');
});

app.get('/info', function (req, res) {
	var pretty = calculations;
	pretty['pool_hashrate'] = parseFloat(pretty['pool_hashrate'].toFixed(0));
	pretty['flo_spotcost_btc'] = parseFloat(pretty['flo_spotcost_btc'].toFixed(8));
	pretty['flo_spotcost_usd'] = parseFloat(pretty['flo_spotcost_usd'].toFixed(8));
	pretty['market_conditions'] = parseFloat(pretty['market_conditions'].toFixed(8));
	pretty['offer_btc'] = parseFloat(pretty['offer_btc'].toFixed(8));
  	res.send(pretty);
  	rentMiners();
});

function updateEnpointData(){
	// Request data async from each endpoint. When all four have been queried then update the calculations.
	var alexandriaPool = false;
	var florincoinInfo = false;
	var miningRigs = false;
	var libraryd = false;

	request('http://pool.alexandria.media/api/stats', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
			calculations['pool_hashrate'] = JSON.parse(body)['pools']['florincoin']['hashrate'];
			alexandriaPool = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})

	request('http://florincoin.alexandria.io/getMiningInfo', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
			calculations['fbd_networkhashps'] = JSON.parse(body)['networkhashps'];
			florincoinInfo = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})

	request('https://www.miningrigrentals.com/api/v1/rigs?method=list&type=scrypt', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
			calculations['MiningRigRentals_last10'] = parseFloat(JSON.parse(body)['data']['info']['price']['last_10']);
			miningRigs = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})

	request('https://api.alexandria.io/flo-market-data/v1/getAll', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
			calculations['fmd_weighted_btc'] = parseFloat(JSON.parse(body)['weighted']);
			calculations['fmd_weighted_usd'] = parseFloat(JSON.parse(body)['USD']);
			libraryd = true;
			if (alexandriaPool && florincoinInfo && miningRigs && libraryd)
				updateCalculations();
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})
}

function updateCalculations(){
	var FLO_reward = 25;
	calculations['flo_spotcost_btc'] = calculations['fbd_networkhashps'] * calculations['MiningRigRentals_last10'] / 1000000 / (2160 * FLO_reward);
	calculations['flo_spotcost_usd'] = calculations['flo_spotcost_btc'] * calculations['fmd_weighted_usd'] / calculations['fmd_weighted_btc'];
	calculations['pool_influence'] = calculations['pool_hashrate'] / (calculations['fbd_networkhashps'] - calculations['pool_hashrate']);

	if (calculations['pool_influence'] <= 1){
		calculations['pool_influence_code'] = 0;
		calculations['pool_influence_multiplier'] = 1;
	}
	else{
		calculations['pool_influence_code'] = 1;
		calculations['pool_influence_multiplier'] = 1 / (calculations['pool_influence'] * calculations['pool_influence']);
	}

	calculations['market_conditions'] = ((((calculations['pool_max_margin'] / 100) + 1) * calculations['flo_spotcost_btc']) / calculations['fmd_weighted_btc']);

	if (calculations['market_conditions'] <= 0){
		calculations['market_conditions_code'] = 0;
		calculations['market_conditions_multiplier'] = 1;
	} else if (calculations['market_conditions'] > 0 && calculations['market_conditions'] <= 1){
		calculations['market_conditions_code'] = 1;
		calculations['market_conditions_multiplier'] = 1 - (Math.pow(calculations['market_conditions'], 0.5));
	} else {
		calculations['market_conditions_code'] = 2;
		calculations['market_conditions_multiplier'] = 0;
	}

	calculations['pool_margin'] = calculations['pool_max_margin'] * calculations['pool_influence_multiplier'] * calculations['market_conditions_multiplier'];

	calculations['offer_btc'] = calculations['flo_spotcost_btc'] * (1 + calculations['pool_margin']);
}

function rentMiners(){
	// First search for rentals that are below the average price.
	request('https://www.miningrigrentals.com/api/v1/rigs?method=list&type=scrypt', function (error, response, body) {
	  	if (!error && response.statusCode == 200) {
	  		var rigs = JSON.parse(body)['data']['records'];
	  		var goodRigs = [];
	  		var rigsToRent = [];
	  		// Add the rigs to the good rigs if they are available for at least a week and are below the average price.
	  		for (var i = 0; i < rigs.length; i++) {
	  			if (rigs[i]['minhrs'] <= config.rental_length_hrs && rigs[i]['maxhrs'] >= config.rental_length_hrs)
	  				goodRigs.push(rigs[i]);
	  		}
			
			console.log(goodRigs.length);
			// Sort the rigs by RPI
			goodRigs.sort(function(a, b) {
				return parseFloat(a.price) - parseFloat(b.price);
			});
			// Check the RPI of each rig and add it to the rigsToRent as long as we are under the weekly budget.
			var totalCost = 0;
			var totalNewHash = 0;
			for (var i = 0; i < goodRigs.length; i++) {
				if (goodRigs[i].rpi >= config['RPI_threshold'] && goodRigs[i]['price'] < calculations['MiningRigRentals_last10'] && (totalCost + parseFloat(goodRigs[i].price_hr)) <= ((config['weekly_budget_btc']/168)*config['rental_length_hrs']) && calculations['pool_margin'] >= config['min_margin']){
					rigsToRent.push(goodRigs[i]);
					totalNewHash += parseFloat(goodRigs[i].hashrate);
					totalCost += parseFloat(goodRigs[i].price_hr)*config['rental_length_hrs'];
					calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate);
					goodRigs.splice(i, 1);
					updateCalculations();
				}
			}
			for (var i = 0; i < goodRigs.length; i++) {
				if (goodRigs[i].rpi > config['RPI_threshold'] && (totalCost + parseFloat(goodRigs[i].price_hr)) <= ((config['weekly_budget_btc']/168)*config['rental_length_hrs']) && calculations['pool_margin'] >= config['min_margin']){
					rigsToRent.push(goodRigs[i]);
					totalNewHash += parseFloat(goodRigs[i].hashrate);
					totalCost += parseFloat(goodRigs[i].price_hr)*config['rental_length_hrs'];
					calculations['pool_hashrate'] = parseInt(calculations['pool_hashrate']) + parseInt(goodRigs.hashrate);
					updateCalculations();
				}
			}

			console.log(rigsToRent);
			console.log("Hashrate to Rent: " + (totalNewHash / 1000000000));
			console.log("Cost to Rent: " + totalCost);

			var MRRAPI = new MiningRigRentalsAPI(config.MRR_API_key, config.MRR_API_secret);

			if (rigsToRent.length != 0){
				MRRAPI.getBalance(function(error, response){
					if (error){
						console.log(error);
						return;
					}
					console.log(response);
					var balance = JSON.parse(response)['data']['confirmed'];
					console.log(balance);
					if (parseFloat(balance) > totalCost){
						for (var i = 0; i < rigsToRent.length; i++) {
							console.log(rigsToRent[i]);
							var args = {'id': parseInt(rigsToRent[i].id), 'length': config.rental_length_hrs, 'profileid': config.profileid};
							console.log(args);
							MRRAPI.rentRig(args, function(error, response){
								if (error){
									console.log(error);
								}
								console.log('Response: ' + response);
							});
						}
					}
				});
			}
	  	} else {
	  		console.log('Error! ' + error);
	  		console.log(response);
	  		console.log(body);
	  	}
	})
}

updateEnpointData();

app.listen(3000, function () {
	console.log('autominer-api listening on port 3000!');
});