/* global bag, $, ws*/
/* global escapeHtml, toTitleCase, formatDate, known_companies, transfer_marble, record_company, show_tx_step, refreshHomePanel, auditingMarble*/
/* exported build_marble, record_company, build_user_panels, build_company_panel, build_notification, populate_users_marbles*/
/* exported build_a_tx, marbles */

var marbles = {};

// =================================================================================
//	UI Building
// =================================================================================
//build a marble
function build_marble(marble) {
	var html = '';
	var colorClass = '';
	var size = 'largeMarble';
	var auditing = '';

	marbles[marble.name] = marble;

	marble.name = escapeHtml(marble.name);
	marble.color = escapeHtml(marble.color);
	marble.owner.username = escapeHtml(marble.owner.username);
	marble.owner.company = escapeHtml(marble.owner.company);
	var full_owner = build_full_owner(marble.owner.username, marble.owner.company);

	console.log('[ui] building marble: ', marble.color, full_owner, marble.name.substring(0, 4) + '...');
	if (marble.size == 16) size = 'smallMarble';
	if (marble.color) colorClass = marble.color.toLowerCase() + 'bg';

	if(auditingMarble && marble.name ===  auditingMarble.name) auditing = 'auditingMarble';

	html += '<span id="' + marble.name + '" class="ball ' + size + ' ' + colorClass + ' ' + auditing + ' title="' + marble.name + '"';
	html += ' username="' + marble.owner.username + '" company="' + marble.owner.company + '"></span>';

	$('.marblesWrap[full_owner="' + full_owner + '"]').find('.innerMarbleWrap').prepend(html);
	$('.marblesWrap[full_owner="' + full_owner + '"]').find('.noMarblesMsg').hide();
	return html;
}

//redraw the user's marbles
function populate_users_marbles(msg) {
	var full_owner = build_full_owner(msg.username, msg.company);

	//reset
	console.log('[ui] clearing marbles for user ' + full_owner);
	$('.marblesWrap[full_owner="' + full_owner + '"]').find('.innerMarbleWrap').html('<i class="fa fa-plus addMarble"></i>');
	$('.marblesWrap[full_owner="' + full_owner + '"]').find('.noMarblesMsg').show();

	for (var i in msg.marbles) {
		build_marble(msg.marbles[i]);
	}
}

//crayp resize - dsh to do, dynamic one
function size_user_name(name) {
	var style = '';
	if (name.length >= 10) style = 'font-size: 22px;';
	if (name.length >= 15) style = 'font-size: 18px;';
	if (name.length >= 20) style = 'font-size: 15px;';
	if (name.length >= 25) style = 'font-size: 11px;';
	return style;
}

//build all user panels
function build_user_panels(data) {
	var full_owner = '';

	//reset
	console.log('[ui] clearing all user panels');
	$('.ownerWrap').html('');
	for (var x in known_companies) {
		known_companies[x].count = 0;
		known_companies[x].visible = 0;							//reset visible counts
	}

	for (var i in data) {
		var html = '';
		var colorClass = '';
		data[i].username = escapeHtml(data[i].username);
		data[i].company = escapeHtml(data[i].company);
		record_company(data[i].company);
		known_companies[data[i].company].count++;
		known_companies[data[i].company].visible++;

		full_owner = build_full_owner(data[i].username, data[i].company);
		console.log('[ui] building owner panel ' + full_owner);

		html += '<div id="user' + i + 'wrap" username="' + data[i].username + '" company="' + data[i].company +
			'" full_owner="' + full_owner + '" class="marblesWrap ' + colorClass + '">';
		html += '<div class="legend" style="' + size_user_name(data[i].username) + '">';
		html += toTitleCase(data[i].username);
		html += '<span class="fa fa-thumb-tack marblesCloseSectionPos marblesFix" title="Never Hide Owner"></span>';
		html += '</div>';
		html += '<div class="innerMarbleWrap"><i class="fa fa-plus addMarble"></i></div>';
		html += '<div class="noMarblesMsg hint">No marbles</div>';
		html += '</div>';

		$('.companyPanel[company="' + data[i].company + '"]').find('.ownerWrap').append(html);
		$('.companyPanel[company="' + data[i].company + '"]').find('.companyVisible').html(known_companies[data[i].company].visible);
		$('.companyPanel[company="' + data[i].company + '"]').find('.companyCount').html(known_companies[data[i].company].count);
	}

	//drag and drop marble
	$('.innerMarbleWrap').sortable({ connectWith: '.innerMarbleWrap', items: 'span' }).disableSelection();
	$('.innerMarbleWrap').droppable({
		drop:
		function (event, ui) {
			var marble_id = $(ui.draggable).attr('id');

			//  ------------ Delete Marble ------------ //
			if ($(event.target).attr('id') === 'trashbin') {
				console.log('removing marble', marble_id);
				show_tx_step({ state: 'building_proposal' }, function () {
					var obj = {
						type: 'delete_marble',
						name: marble_id,
						v: 1
					};
					ws.send(JSON.stringify(obj));
					$(ui.draggable).addClass('invalid bounce');
					refreshHomePanel();
				});
			}

			//  ------------ Audit Marble ------------ //
			else if ($(event.target).attr('id') === 'auditContentWrap') {
				console.log('audit marble', marble_id);
				return false;
				/*show_tx_step({ state: 'building_proposal' }, function () {
					var obj = {
						type: 'delete_marble',
						name: marble_id,
						v: 1
					};
					ws.send(JSON.stringify(obj));
					$(ui.draggable).addClass('invalid bounce');
					refreshHomePanel();
				});*/
			}

			//  ------------ Transfer Marble ------------ //
			else {
				var dragged_user = $(ui.draggable).attr('username').toLowerCase();
				var dropped_user = $(event.target).parents('.marblesWrap').attr('username').toLowerCase();
				var dropped_company = $(event.target).parents('.marblesWrap').attr('company');

				console.log('dropped a marble', dragged_user, dropped_user, dropped_company);
				if (dragged_user != dropped_user) {										//only transfer marbles that changed owners
					$(ui.draggable).addClass('invalid bounce');
					transfer_marble(marble_id, dropped_user, dropped_company);
					return true;
				}
			}
		}
	});

	//user count
	$('#foundUsers').html(data.length);
	$('#totalUsers').html(data.length);
}

//build company wrap
function build_company_panel(company) {
	company = escapeHtml(company);
	console.log('[ui] building company panel ' + company);

	var mycss = '';
	if (company === escapeHtml(bag.marble_company)) mycss = 'myCompany';

	var html = '';
	html += '<div class="companyPanel" company="' + company + '">';
	html += '<div class="companyNameWrap ' + mycss + '">';
	html += '<span class="companyName">' + company + '&nbsp;-&nbsp;</span>';
	html += '<span class="companyVisible">0</span>/';
	html += '<span class="companyCount">0</span>';
	if (company === escapeHtml(bag.marble_company)) {
		html += '<span class="fa fa-exchange floatRight"></span>';
	}
	else {
		html += '<span class="fa fa-long-arrow-left floatRight"></span>';
	}
	html += '</div>';
	html += '<div class="ownerWrap"></div>';
	html += '</div>';
	$('#allUserPanelsWrap').append(html);
}

//build the correct "full owner" string - concate username and company
function build_full_owner(username, company) {
	return escapeHtml(username.toLowerCase() + '.' + company);
}

//build a notification msg, `error` is boolean
function build_notification(error, msg) {
	var html = '';
	var css = '';
	var iconClass = 'fa-check';
	if (error) {
		css = 'warningNotice';
		iconClass = 'fa-minus-circle';
	}

	html += '<div class="notificationWrap ' + css + '">';
	html += '<span class="fa ' + iconClass + ' notificationIcon"></span>';
	html += '<span class="noticeTime">' + formatDate(Date.now(), '%M/%d %I:%m:%s') + '&nbsp;&nbsp;</span>';
	html += '<span>' + escapeHtml(msg) + '</span>';
	html += '<span class="fa fa-close closeNotification"></span>';
	html += '</div>';
	return html;
}


//build a tx history div
function build_a_tx(data, pos) {
	var html = '';
	var username = '-';
	var company = '-';
	if(data &&  data.Value && data.Value.owner) {
		username = data.Value.owner.username;
		company = data.Value.owner.company;
	}

	html += '<div class="txDetails">';
	html +=		'<div class="txCount">TX ' + (Number(pos) + 1) + '</div>';
	html +=		'<p>';
	html +=			'<div class="marbleLegend">Transaction: </div>';
	html +=			'<div class="marbleName txId">' + data.TxId.substring(0, 14) + '...</div>';
	html +=		'</p>';
	html +=		'<p>';
	html +=			'<div class="marbleLegend">Owner: </div>';
	html +=			'<div class="marbleName">' + username + '</div>';
	html +=		'</p>';
	html +=		'<p>';
	html +=			'<div class="marbleLegend">Company: </div>';
	html +=			'<div class="marbleName">' + company  + '</div>';
	html +=		'</p>';
	html +=	'</div>';
	return html;
}
