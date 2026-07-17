/**
 * S&D Express CRM API
 * Runtime: Google Apps Script V8
 * Deploy as: Web app / Execute as Me / Who has access: Anyone
 */
const APP = Object.freeze({
  VERSION: '1.0.0',
  TIMEZONE: 'Asia/Kuala_Lumpur',
  SESSION_HOURS: 6,
  SHEETS: {
    Bookings: ['Booking ID','Created Date','Updated Date','Customer ID','Customer Name','Phone','Email','Vehicle ID','Vehicle Name','Pickup Date','Pickup Time','Return Date','Return Time','Pickup Location','Drop Location','Passenger','Trip Type','Rental Days','Daily Rate','Subtotal','Additional Charges','Discount','Total Amount','Payment Status','Booking Status','Customer Notes','Admin Notes'],
    Vehicles: ['Vehicle ID','Vehicle Name','Type','Capacity','Daily Rate','Status','Image URL'],
    Customers: ['Customer ID','Name','Phone','Email','Total Booking','Total Spending','Last Booking'],
    Payments: ['Payment ID','Booking ID','Amount','Payment Method','Receipt Status','Verification Status','Created Date','Updated Date'],
    Users: ['User ID','Email','Password Hash','Salt','Role','Active','Session Token Hash','Session Expiry'],
    Settings: ['Setting Key','Setting Value'],
    AuditLog: ['Timestamp','User','Action','Entity','Entity ID','Details']
  }
});

function doGet(e) { return route_((e && e.parameter) || {}, 'GET'); }
function doPost(e) {
  var payload = {};
  try { payload = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return output_(false, null, 'Invalid JSON request.', 'INVALID_JSON'); }
  return route_(payload, 'POST');
}

function route_(req, method) {
  try {
    var action = clean_(req.action, 60).toUpperCase();
    if (!action) throw apiError_('Action is required.', 'MISSING_ACTION');
    var publicActions = ['GET_VEHICLES','CREATE_BOOKING','CHECK_AVAILABILITY','TRACK_BOOKING','LOGIN_ADMIN','HEALTH'];
    var actor = publicActions.indexOf(action) >= 0 ? null : authenticate_(req.token);
    var handlers = {
      HEALTH: function(){ return { version: APP.VERSION, time: isoNow_() }; },
      GET_VEHICLES: function(){ return getVehicles_(actor); },
      CREATE_BOOKING: function(){ return createBooking_(req.booking || req); },
      CHECK_AVAILABILITY: function(){ return checkAvailability_(req.vehicleId, req.pickupDate, req.returnDate, req.excludeBookingId); },
      TRACK_BOOKING: function(){ return trackBooking_(req.bookingId, req.phone); },
      LOGIN_ADMIN: function(){ return login_(req.email, req.password); },
      GET_BOOKINGS: function(){ return getBookings_(req); },
      GET_DASHBOARD: function(){ return getDashboard_(); },
      GET_CUSTOMERS: function(){ return getCustomers_(); },
      GET_PAYMENTS: function(){ return getPayments_(); },
      GET_REPORTS: function(){ return getReports_(); },
      GET_SETTINGS: function(){ return getSettings_(); },
      UPDATE_BOOKING: function(){ return updateBooking_(req.bookingId, req.updates, actor); },
      DELETE_BOOKING: function(){ return deleteBooking_(req.bookingId, actor); },
      UPDATE_PAYMENT: function(){ return updatePayment_(req, actor); },
      UPSERT_VEHICLE: function(){ return upsertVehicle_(req.vehicle, actor); },
      UPDATE_SETTINGS: function(){ return updateSettings_(req.settings, actor); }
    };
    if (!handlers[action]) throw apiError_('Unsupported action: ' + action, 'INVALID_ACTION');
    return output_(true, handlers[action](), 'OK');
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return output_(false, null, err.message || 'Unexpected server error.', err.code || 'SERVER_ERROR');
  }
}

/** Run once from the Apps Script editor. Safe to re-run; it preserves existing data. */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Create this script from Extensions > Apps Script inside the CRM spreadsheet.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(APP.TIMEZONE);
  Object.keys(APP.SHEETS).forEach(function(name){ ensureSheet_(ss, name, APP.SHEETS[name]); });
  seedVehicles_();
  seedSettings_();
  var tempPassword = seedAdmin_();
  formatSheets_();
  console.log('S&D Express database is ready.');
  if (tempPassword) console.log('TEMPORARY ADMIN LOGIN -> Email: admin@sdexpress.my | Password: ' + tempPassword + ' | Change it with resetAdminPassword() after first login.');
  return 'Database setup complete. Check the execution log for a temporary login if this is the first run.';
}

/** Run manually to replace the administrator password. Never store the plain password in a Sheet. */
function resetAdminPassword(email, newPassword) {
  email = clean_(email || 'admin@sdexpress.my', 150).toLowerCase();
  if (!newPassword || String(newPassword).length < 10) throw new Error('Password must contain at least 10 characters.');
  var rows = rows_('Users'), user = rows.filter(function(r){ return String(r.email).toLowerCase() === email; })[0];
  if (!user) throw new Error('Admin user not found: ' + email);
  var salt = Utilities.getUuid().replace(/-/g,'');
  updateRow_('Users', user._row, {'Password Hash': hash_(salt + String(newPassword)), 'Salt': salt, 'Session Token Hash': '', 'Session Expiry': ''});
  console.log('Password updated for ' + email + '.');
}

function createBooking_(input) {
  var required = ['name','phone','vehicleId','pickupDate','pickupTime','returnDate','returnTime','pickupLocation','dropLocation','passenger','tripType'];
  required.forEach(function(k){ if (!clean_(input[k], 1000)) throw apiError_('Please complete all required booking details.', 'VALIDATION_ERROR'); });
  var pickup = dateKey_(input.pickupDate), ret = dateKey_(input.returnDate);
  if (ret < pickup) throw apiError_('Return date cannot be before pickup date.', 'INVALID_DATE');
  var vehicle = rows_('Vehicles').filter(function(v){ return v.vehicleId === clean_(input.vehicleId,30); })[0];
  if (!vehicle || vehicle.status !== 'Available') throw apiError_('The selected vehicle is not available.', 'VEHICLE_UNAVAILABLE');
  var passenger = number_(input.passenger, 1, 999);
  if (passenger > Number(vehicle.capacity)) throw apiError_('Passenger count exceeds this vehicle capacity.', 'CAPACITY_EXCEEDED');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    checkAvailability_(vehicle.vehicleId, pickup, ret);
    var customer = findOrCreateCustomer_(input);
    var bookingId = nextId_('SD', 'Bookings', 'Booking ID', true);
    var days = daysInclusive_(pickup, ret), rate = Number(vehicle.dailyRate), subtotal = days * rate;
    var additional = Math.max(0, Number(input.additionalCharges) || 0), discount = Math.max(0, Number(input.discount) || 0);
    var total = Math.max(0, subtotal + additional - discount), now = isoNow_();
    append_('Bookings', {
      'Booking ID': bookingId, 'Created Date': now, 'Updated Date': now, 'Customer ID': customer.customerId,
      'Customer Name': clean_(input.name,100), 'Phone': clean_(input.phone,30), 'Email': clean_(input.email,150),
      'Vehicle ID': vehicle.vehicleId, 'Vehicle Name': vehicle.vehicleName, 'Pickup Date': pickup, 'Pickup Time': clean_(input.pickupTime,10),
      'Return Date': ret, 'Return Time': clean_(input.returnTime,10), 'Pickup Location': clean_(input.pickupLocation,250),
      'Drop Location': clean_(input.dropLocation,250), 'Passenger': passenger, 'Trip Type': clean_(input.tripType,60),
      'Rental Days': days, 'Daily Rate': rate, 'Subtotal': subtotal, 'Additional Charges': additional, 'Discount': discount,
      'Total Amount': total, 'Payment Status': 'Waiting Payment', 'Booking Status': 'New Inquiry',
      'Customer Notes': clean_(input.customerNotes,1000), 'Admin Notes': ''
    });
    var settings = getSettings_(), deposit = round2_(total * (Number(settings.depositPercentage || 50) / 100));
    append_('Payments', {'Payment ID': nextId_('PAY','Payments','Payment ID',false), 'Booking ID': bookingId, 'Amount': deposit, 'Payment Method': 'Bank Transfer', 'Receipt Status': 'Not Submitted', 'Verification Status': 'Pending', 'Created Date': now, 'Updated Date': now});
    refreshCustomerTotals_(customer.customerId);
    audit_('PUBLIC','CREATE_BOOKING','Booking',bookingId,'New customer booking');
    notifyEvent_('NEW_BOOKING', {bookingId:bookingId, customerName:clean_(input.name,100), totalAmount:total});
    return { bookingId:bookingId, totalAmount:total, depositAmount:deposit, payment:{businessName:settings.businessName,bankName:settings.bankName,accountNumber:settings.accountNumber,accountHolder:settings.accountHolder,duitNowQrUrl:settings.duitNowQrUrl} };
  } finally { lock.releaseLock(); }
}

function checkAvailability_(vehicleId, pickupDate, returnDate, excludeId) {
  vehicleId = clean_(vehicleId,30); var pickup=dateKey_(pickupDate), ret=dateKey_(returnDate);
  if (!vehicleId || !pickup || !ret || ret < pickup) throw apiError_('Enter a valid pickup and return date.', 'INVALID_DATE');
  var blocking = ['New Inquiry','Quotation Sent','Waiting Deposit','Payment Review','Confirmed','On Trip'];
  var conflict = rows_('Bookings').filter(function(b){ return b.vehicleId===vehicleId && b.bookingId!==excludeId && blocking.indexOf(b.bookingStatus)>=0 && pickup<=b.returnDate && ret>=b.pickupDate; })[0];
  if (conflict) throw apiError_('Vehicle unavailable for these dates. Please select another vehicle or date.', 'VEHICLE_UNAVAILABLE');
  return {available:true, vehicleId:vehicleId, pickupDate:pickup, returnDate:ret};
}

function trackBooking_(bookingId, phone) {
  bookingId=clean_(bookingId,30).toUpperCase(); phone=phoneKey_(phone);
  if (!bookingId || !phone) throw apiError_('Booking ID and phone number are required.', 'VALIDATION_ERROR');
  var b=rows_('Bookings').filter(function(x){ return x.bookingId===bookingId && phoneKey_(x.phone)===phone; })[0];
  if (!b) throw apiError_('No booking matched those details. Check the booking ID and phone number.', 'NOT_FOUND');
  return pick_(b,['bookingId','vehicleName','pickupDate','returnDate','pickupLocation','dropLocation','tripType','totalAmount','paymentStatus','bookingStatus']);
}

function login_(email,password) {
  email=clean_(email,150).toLowerCase(); password=String(password||'');
  if (!email || !password) throw apiError_('Email and password are required.', 'INVALID_LOGIN');
  var user=rows_('Users').filter(function(u){ return String(u.email).toLowerCase()===email && String(u.active).toLowerCase()==='true'; })[0];
  if (!user || !constantEqual_(hash_(user.salt+password),user.passwordHash)) { Utilities.sleep(350); throw apiError_('Invalid email or password.', 'INVALID_LOGIN'); }
  var token=Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''), expiry=new Date(Date.now()+APP.SESSION_HOURS*3600000).toISOString();
  updateRow_('Users',user._row,{'Session Token Hash':hash_(token),'Session Expiry':expiry});
  audit_(email,'LOGIN','User',user.userId,'Successful login');
  return {token:token,user:{userId:user.userId,email:user.email,role:user.role},expiresAt:expiry};
}

function authenticate_(token) {
  token=clean_(token,200); if (!token) throw apiError_('Please sign in to continue.', 'UNAUTHORIZED');
  var tokenHash=hash_(token), now=new Date();
  var user=rows_('Users').filter(function(u){ return String(u.active).toLowerCase()==='true' && constantEqual_(u.sessionTokenHash,tokenHash) && new Date(u.sessionExpiry)>now; })[0];
  if (!user) throw apiError_('Your session has expired. Please sign in again.', 'UNAUTHORIZED');
  return {userId:user.userId,email:user.email,role:user.role};
}

function getVehicles_(actor) { return rows_('Vehicles').map(function(v){ return pick_(v,['vehicleId','vehicleName','type','capacity','dailyRate','status','imageUrl']); }); }
function getBookings_(req) { var all=rows_('Bookings'); if(req.bookingId)all=all.filter(function(b){return b.bookingId===req.bookingId;}); return all.sort(function(a,b){return String(b.createdDate).localeCompare(String(a.createdDate));}).map(publicBooking_); }
function getCustomers_(){ return rows_('Customers').sort(function(a,b){return Number(b.totalSpending)-Number(a.totalSpending);}).map(function(c){return pick_(c,['customerId','name','phone','email','totalBooking','totalSpending','lastBooking']);}); }
function getPayments_(){ var bookings=indexBy_(rows_('Bookings'),'bookingId'); return rows_('Payments').sort(function(a,b){return String(b.createdDate).localeCompare(String(a.createdDate));}).map(function(p){var out=pick_(p,['paymentId','bookingId','amount','paymentMethod','receiptStatus','verificationStatus','createdDate','updatedDate']);out.customerName=bookings[p.bookingId]?bookings[p.bookingId].customerName:'';return out;}); }
function getSettings_(){ var out={}; rows_('Settings').forEach(function(r){out[r.settingKey]=r.settingValue;}); return out; }

function getDashboard_(){
  var bookings=rows_('Bookings'), vehicles=rows_('Vehicles'), now=new Date(), today=formatDate_(now,'yyyy-MM-dd'), month=formatDate_(now,'yyyy-MM');
  var active=bookings.filter(function(b){return b.bookingStatus!=='Cancelled';}), paid=active.filter(function(b){return b.paymentStatus==='Paid';});
  return {todayBookings:active.filter(function(b){return b.pickupDate===today;}).length,upcomingTrips:active.filter(function(b){return b.pickupDate>today&&['Confirmed','On Trip'].indexOf(b.bookingStatus)>=0;}).length,monthlyRevenue:sum_(paid.filter(function(b){return String(b.pickupDate).slice(0,7)===month;}),'totalAmount'),paidAmount:sum_(paid,'totalAmount'),pendingAmount:sum_(active.filter(function(b){return b.paymentStatus!=='Paid';}),'totalAmount'),availableVehicles:vehicles.filter(function(v){return v.status==='Available';}).length,revenueChart:revenueChart_(bookings),recentBookings:bookings.sort(function(a,b){return String(b.createdDate).localeCompare(String(a.createdDate));}).slice(0,6).map(publicBooking_),upcomingBookings:active.filter(function(b){return b.pickupDate>=today;}).sort(function(a,b){return a.pickupDate.localeCompare(b.pickupDate);}).slice(0,8).map(publicBooking_)};
}

function getReports_(){var all=rows_('Bookings'),active=all.filter(function(b){return b.bookingStatus!=='Cancelled';}),paid=active.filter(function(b){return b.paymentStatus==='Paid';}),complete=active.filter(function(b){return b.bookingStatus==='Completed';}),usage={};active.forEach(function(b){usage[b.vehicleName]=(usage[b.vehicleName]||0)+1;});return{totalRevenue:sum_(paid,'totalAmount'),averageBooking:active.length?round2_(sum_(active,'totalAmount')/active.length):0,completionRate:active.length?Math.round(complete.length/active.length*100):0,revenueChart:revenueChart_(all),vehicleUsage:Object.keys(usage).map(function(k){return{label:k,value:usage[k]};})};}

function updateBooking_(bookingId, updates, actor){var b=findRow_('Bookings','bookingId',bookingId);if(!b)throw apiError_('Booking not found.','NOT_FOUND');updates=updates||{};var allowed={bookingStatus:'Booking Status',paymentStatus:'Payment Status',additionalCharges:'Additional Charges',discount:'Discount',adminNotes:'Admin Notes',pickupDate:'Pickup Date',returnDate:'Return Date',vehicleId:'Vehicle ID'};var patch={'Updated Date':isoNow_()};Object.keys(allowed).forEach(function(k){if(updates[k]!==undefined)patch[allowed[k]]=clean_(updates[k],1000);});var additional=updates.additionalCharges!==undefined?Math.max(0,Number(updates.additionalCharges)||0):Number(b.additionalCharges),discount=updates.discount!==undefined?Math.max(0,Number(updates.discount)||0):Number(b.discount);patch['Total Amount']=Math.max(0,Number(b.subtotal)+additional-discount);updateRow_('Bookings',b._row,patch);refreshCustomerTotals_(b.customerId);audit_(actor.email,'UPDATE_BOOKING','Booking',bookingId,JSON.stringify(updates));notifyEvent_('BOOKING_UPDATED',{bookingId:bookingId,status:updates.bookingStatus||b.bookingStatus});return{bookingId:bookingId,updated:true};}
function deleteBooking_(bookingId,actor){var b=findRow_('Bookings','bookingId',bookingId);if(!b)throw apiError_('Booking not found.','NOT_FOUND');var pays=rows_('Payments').filter(function(p){return p.bookingId===bookingId;}).sort(function(a,b){return b._row-a._row;});pays.forEach(function(p){sheet_('Payments').deleteRow(p._row);});sheet_('Bookings').deleteRow(b._row);refreshCustomerTotals_(b.customerId);audit_(actor.email,'DELETE_BOOKING','Booking',bookingId,'Deleted booking and related payments');return{deleted:true};}
function updatePayment_(req,actor){var p=findRow_('Payments','paymentId',req.paymentId);if(!p)throw apiError_('Payment record not found.','NOT_FOUND');var status=clean_(req.verificationStatus,30);if(['Paid','Rejected','Waiting Verification','Pending'].indexOf(status)<0)throw apiError_('Invalid payment status.','VALIDATION_ERROR');updateRow_('Payments',p._row,{'Verification Status':status,'Receipt Status':status==='Paid'?'Verified':status==='Rejected'?'Rejected':p.receiptStatus,'Updated Date':isoNow_()});var b=findRow_('Bookings','bookingId',p.bookingId);if(b)updateRow_('Bookings',b._row,{'Payment Status':status,'Booking Status':status==='Paid'?'Confirmed':status==='Rejected'?'Waiting Deposit':b.bookingStatus,'Updated Date':isoNow_()});audit_(actor.email,'UPDATE_PAYMENT','Payment',p.paymentId,status);notifyEvent_('PAYMENT_'+status.toUpperCase().replace(/ /g,'_'),{bookingId:p.bookingId,paymentId:p.paymentId});return{updated:true};}
function upsertVehicle_(v,actor){v=v||{};var id=clean_(v.vehicleId,30).toUpperCase();if(!id||!clean_(v.vehicleName,100)||!Number(v.capacity)||Number(v.dailyRate)<0)throw apiError_('Complete all required vehicle fields.','VALIDATION_ERROR');var data={'Vehicle ID':id,'Vehicle Name':clean_(v.vehicleName,100),'Type':clean_(v.type,30),'Capacity':number_(v.capacity,1,999),'Daily Rate':number_(v.dailyRate,0,100000),'Status':clean_(v.status,30),'Image URL':clean_(v.imageUrl,500)},row=findRow_('Vehicles','vehicleId',id);if(row)updateRow_('Vehicles',row._row,data);else append_('Vehicles',data);audit_(actor.email,'UPSERT_VEHICLE','Vehicle',id,'');return{vehicleId:id,saved:true};}
function updateSettings_(settings,actor){settings=settings||{};Object.keys(settings).forEach(function(key){var row=findRow_('Settings','settingKey',key),data={'Setting Key':key,'Setting Value':clean_(settings[key],2000)};if(row)updateRow_('Settings',row._row,data);else append_('Settings',data);});audit_(actor.email,'UPDATE_SETTINGS','Settings','GLOBAL','');return{saved:true};}

function findOrCreateCustomer_(input){var phone=phoneKey_(input.phone),existing=rows_('Customers').filter(function(c){return phoneKey_(c.phone)===phone;})[0];if(existing){updateRow_('Customers',existing._row,{'Name':clean_(input.name,100),'Email':clean_(input.email,150)});return existing;}var id=nextId_('CUS','Customers','Customer ID',false);append_('Customers',{'Customer ID':id,'Name':clean_(input.name,100),'Phone':clean_(input.phone,30),'Email':clean_(input.email,150),'Total Booking':0,'Total Spending':0,'Last Booking':''});return findRow_('Customers','customerId',id);}
function refreshCustomerTotals_(customerId){var c=findRow_('Customers','customerId',customerId);if(!c)return;var b=rows_('Bookings').filter(function(x){return x.customerId===customerId&&x.bookingStatus!=='Cancelled';});b.sort(function(a,z){return String(z.pickupDate).localeCompare(String(a.pickupDate));});updateRow_('Customers',c._row,{'Total Booking':b.length,'Total Spending':sum_(b.filter(function(x){return x.paymentStatus==='Paid';}),'totalAmount'),'Last Booking':b.length?b[0].pickupDate:''});}
function publicBooking_(b){return pick_(b,['bookingId','createdDate','customerId','customerName','phone','email','vehicleId','vehicleName','pickupDate','pickupTime','returnDate','returnTime','pickupLocation','dropLocation','passenger','tripType','rentalDays','dailyRate','subtotal','additionalCharges','discount','totalAmount','paymentStatus','bookingStatus','customerNotes','adminNotes']);}
function revenueChart_(bookings){var out=[],now=new Date();for(var i=5;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1),key=formatDate_(d,'yyyy-MM'),label=Utilities.formatDate(d,APP.TIMEZONE,'MMM');out.push({label:label,value:sum_(bookings.filter(function(b){return b.paymentStatus==='Paid'&&String(b.pickupDate).slice(0,7)===key;}),'totalAmount')});}return out;}

function seedVehicles_(){if(rows_('Vehicles').length)return;append_('Vehicles',{'Vehicle ID':'VH001','Vehicle Name':'Toyota Hiace 11 Seater','Type':'Van','Capacity':11,'Daily Rate':350,'Status':'Available','Image URL':''});append_('Vehicles',{'Vehicle ID':'BS001','Vehicle Name':'Bus 40 Seater','Type':'Bus','Capacity':40,'Daily Rate':500,'Status':'Available','Image URL':''});}
function seedSettings_(){var defaults={businessName:'S&D EXPRESS DELIVERY SERVICE',bankName:'',accountNumber:'',accountHolder:'S&D EXPRESS DELIVERY SERVICE',phone:'',email:'',address:'Malaysia',logoUrl:'',duitNowQrUrl:'',depositPercentage:'50',paymentTerms:'A 50% deposit is required to secure a confirmed booking. Balance payment terms are agreed before travel.'};Object.keys(defaults).forEach(function(k){if(!findRow_('Settings','settingKey',k))append_('Settings',{'Setting Key':k,'Setting Value':defaults[k]});});}
function seedAdmin_(){if(rows_('Users').length)return '';var password='Sd!'+Utilities.getUuid().replace(/-/g,'').slice(0,12),salt=Utilities.getUuid().replace(/-/g,'');append_('Users',{'User ID':'USR001','Email':'admin@sdexpress.my','Password Hash':hash_(salt+password),'Salt':salt,'Role':'Admin','Active':true,'Session Token Hash':'','Session Expiry':''});return password;}
function formatSheets_(){var ss=ss_();Object.keys(APP.SHEETS).forEach(function(name){var sh=ss.getSheetByName(name);sh.setFrozenRows(1);sh.getRange(1,1,1,APP.SHEETS[name].length).setFontWeight('bold').setBackground('#0b1426').setFontColor('#ffffff');sh.autoResizeColumns(1,APP.SHEETS[name].length);if(sh.getFilter())sh.getFilter().remove();if(sh.getLastRow()>1)sh.getRange(1,1,sh.getLastRow(),APP.SHEETS[name].length).createFilter();});}
function ensureSheet_(ss,name,headers){var sh=ss.getSheetByName(name)||ss.insertSheet(name);if(sh.getMaxColumns()<headers.length)sh.insertColumnsAfter(sh.getMaxColumns(),headers.length-sh.getMaxColumns());var current=sh.getRange(1,1,1,headers.length).getValues()[0];headers.forEach(function(h,i){if(!current[i])current[i]=h;else if(current[i]!==h)throw new Error('Header mismatch in '+name+' column '+(i+1)+'. Expected "'+h+'" but found "'+current[i]+'".');});sh.getRange(1,1,1,headers.length).setValues([current]);return sh;}

function ss_(){var id=PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');var ss=id?SpreadsheetApp.openById(id):SpreadsheetApp.getActiveSpreadsheet();if(!ss)throw apiError_('Database is not configured. Run setupDatabase().','NOT_CONFIGURED');return ss;}
function sheet_(name){var sh=ss_().getSheetByName(name);if(!sh)throw apiError_('Missing sheet: '+name+'. Run setupDatabase().','NOT_CONFIGURED');return sh;}
function rows_(name){var sh=sheet_(name),last=sh.getLastRow(),headers=APP.SHEETS[name];if(last<2)return[];var values=sh.getRange(2,1,last-1,headers.length).getDisplayValues();return values.map(function(row,i){var obj={_row:i+2};headers.forEach(function(h,j){obj[key_(h)]=row[j];});return obj;}).filter(function(o){return o[key_(headers[0])]!=='';});}
function append_(name,obj){var headers=APP.SHEETS[name],row=headers.map(function(h){return obj[h]!==undefined?obj[h]:'';});sheet_(name).appendRow(row);}
function updateRow_(name,rowNumber,patch){var headers=APP.SHEETS[name],sh=sheet_(name);Object.keys(patch).forEach(function(header){var col=headers.indexOf(header);if(col>=0)sh.getRange(rowNumber,col+1).setValue(patch[header]);});}
function findRow_(name,key,value){return rows_(name).filter(function(r){return String(r[key])===String(value);})[0]||null;}
function nextId_(prefix,sheetName,header,daily){var date=formatDate_(new Date(),'yyyyMMdd'),start=daily?prefix+'-'+date+'-':prefix+'-',max=0;rows_(sheetName).forEach(function(r){var value=r[key_(header)];if(String(value).indexOf(start)===0){var n=parseInt(String(value).split('-').pop(),10);if(n>max)max=n;}});return start+String(max+1).padStart(3,'0');}
function audit_(user,action,entity,id,details){append_('AuditLog',{'Timestamp':isoNow_(),'User':user,'Action':action,'Entity':entity,'Entity ID':id,'Details':clean_(details,2000)});}
function notifyEvent_(event,payload){console.log('NOTIFICATION_EVENT '+event+' '+JSON.stringify(payload));/* Future adapters: MailApp, Telegram bot, WhatsApp provider. */}
function output_(success,data,message,code){return ContentService.createTextOutput(JSON.stringify({success:success,data:data,message:message,code:code||null,timestamp:isoNow_()})).setMimeType(ContentService.MimeType.JSON);}
function apiError_(message,code){var e=new Error(message);e.code=code;return e;}
function key_(header){return header.charAt(0).toLowerCase()+header.slice(1).replace(/\s+(.)/g,function(_,c){return c.toUpperCase();});}
function pick_(obj,keys){var out={};keys.forEach(function(k){out[k]=obj[k];});return out;}
function indexBy_(arr,key){var o={};arr.forEach(function(x){o[x[key]]=x;});return o;}
function sum_(arr,key){return round2_(arr.reduce(function(n,x){return n+(Number(x[key])||0);},0));}
function round2_(n){return Math.round((Number(n)||0)*100)/100;}
function number_(value,min,max){var n=Number(value);if(!isFinite(n)||n<min||n>max)throw apiError_('A numeric value is outside the allowed range.','VALIDATION_ERROR');return n;}
function clean_(value,max){return String(value===undefined||value===null?'':value).trim().slice(0,max||500);}
function phoneKey_(value){return String(value||'').replace(/\D/g,'').replace(/^60/,'0');}
function dateKey_(value){var s=clean_(value,30).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(new Date(s+'T00:00:00').getTime()))throw apiError_('Use a valid date.','INVALID_DATE');return s;}
function daysInclusive_(a,b){return Math.floor((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000)+1;}
function isoNow_(){return new Date().toISOString();}
function formatDate_(d,format){return Utilities.formatDate(d,APP.TIMEZONE,format);}
function hash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value),Utilities.Charset.UTF_8).map(function(b){var v=(b<0?b+256:b).toString(16);return v.length===1?'0'+v:v;}).join('');}
function constantEqual_(a,b){a=String(a||'');b=String(b||'');if(a.length!==b.length)return false;var r=0;for(var i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
