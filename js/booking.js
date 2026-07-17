(function(){
 'use strict';
 const {api,money,esc,toast,dateOnly,loading}=window.SD;
 const form=document.getElementById('booking-form');
 if(form){
  let step=1, vehicles=[], selected=null;
  const normalizeVehicleId=value=>String(value||'').trim();
  const normalizeImageUrl=value=>{
   const raw=String(value||'').trim();
   if(!raw)return '';
   try{
    const url=new URL(raw);
    if(url.protocol!=='https:'&&url.protocol!=='http:')return '';
    if(url.hostname==='drive.google.com'){
     const fileMatch=url.pathname.match(/\/file\/d\/([^/]+)/);
     const id=(fileMatch&&fileMatch[1])||url.searchParams.get('id');
     if(id)return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`;
    }
    return url.href;
   }catch{return ''}
  };
  const fallback=[
   {vehicleId:'VH001',vehicleName:'Toyota Hiace 11 Seater',type:'Van',capacity:11,dailyRate:350,status:'Available'},
   {vehicleId:'BS001',vehicleName:'Bus 40 Seater',type:'Bus',capacity:40,dailyRate:500,status:'Available'}
  ];
  const today=new Date();
  today.setMinutes(today.getMinutes()-today.getTimezoneOffset());
  ['pickupDate','returnDate'].forEach(id=>document.getElementById(id).min=today.toISOString().slice(0,10));
  function findAvailableVehicle(vehicleId){
   const id=normalizeVehicleId(vehicleId);
   return id ? vehicles.find(v=>normalizeVehicleId(v.vehicleId)===id&&String(v.status).trim().toLowerCase()==='available')||null : null;
  }
  function syncSelectedVehicle(){
   const checked=form.querySelector('input[name="vehicleId"]:checked');
   selected=checked?findAvailableVehicle(checked.value):null;
   return selected;
  }
  async function loadVehicles(){
   try{vehicles=await api('GET_VEHICLES',{public:'1'},'GET');}
   catch(error){vehicles=fallback;if(window.SD.config.API_URL)toast(error.message,'error');}
   renderVehicles();
  }
  function renderVehicles(){
   const preferred=normalizeVehicleId(new URLSearchParams(location.search).get('vehicle'));
   document.getElementById('vehicle-options').innerHTML=vehicles.map(v=>{
    const vehicleId=normalizeVehicleId(v.vehicleId);
    const available=Boolean(vehicleId)&&String(v.status).trim().toLowerCase()==='available';
    const isPreferred=Boolean(preferred)&&preferred===vehicleId&&available;
    const vehicleType=String(v.type).toLowerCase().includes('bus')?'bus':'van';
    const imageSrc=normalizeImageUrl(v.imageUrl);
    const fallbackArt=`<svg class="vehicle-fallback" viewBox="0 0 700 320"><use href="../assets/fleet.svg#${vehicleType}"/></svg>`;
    const artwork=imageSrc?`<img class="vehicle-option-photo" src="${esc(imageSrc)}" alt="${esc(v.vehicleName)}">${fallbackArt}`:fallbackArt;
    return `<label class="vehicle-option ${isPreferred?'selected':''} ${available?'':'unavailable'}"><input type="radio" name="vehicleId" value="${esc(vehicleId)}" ${isPreferred?'checked':''} ${available?'':'disabled'}><div class="mini-art">${artwork}</div><h3>${esc(v.vehicleName)}</h3><div class="vehicle-meta"><span>${esc(v.capacity)} passengers</span><strong>${money(v.dailyRate)}/day</strong></div><span class="pill ${available?'success':'danger'}" style="margin-top:12px">${available?'Available':'Unavailable'}</span></label>`;
   }).join('');
   document.querySelectorAll('.vehicle-option-photo').forEach(img=>img.addEventListener('error',()=>{img.hidden=true;img.nextElementSibling.hidden=false}));
   const chooseVehicle=vehicleId=>{
    const vehicle=findAvailableVehicle(vehicleId);
    if(!vehicle)return false;
    const selectedId=normalizeVehicleId(vehicle.vehicleId);
    document.querySelectorAll('#vehicle-options .vehicle-option').forEach(card=>{
     const input=card.querySelector('input[name="vehicleId"]');
     const isSelected=normalizeVehicleId(input.value)===selectedId;
     input.checked=isSelected;
     card.classList.toggle('selected',isSelected);
    });
    selected=vehicle;
    return true;
   };
   document.querySelectorAll('#vehicle-options .vehicle-option').forEach(card=>{
    const input=card.querySelector('input[name="vehicleId"]');
    input.addEventListener('change',()=>chooseVehicle(input.value));
    card.addEventListener('click',event=>{
     if(input.disabled)return;
     event.preventDefault();
     chooseVehicle(input.value);
    });
   });
   syncSelectedVehicle();
  }
  function showStep(next){
   step=next;
   document.querySelectorAll('.wizard-panel').forEach(panel=>panel.classList.toggle('active',Number(panel.dataset.panel)===step));
   document.querySelectorAll('.step').forEach(item=>{
    const number=Number(item.dataset.step);
    item.classList.toggle('active',number===step);
    item.classList.toggle('done',number<step);
    item.querySelector('span').textContent=number<step?String.fromCharCode(10003):number;
   });
   document.getElementById('booking-wizard').scrollIntoView({behavior:'smooth',block:'start'});
  }
  function validPanel(){
   const panel=document.querySelector(`.wizard-panel[data-panel="${step}"]`);
   if(step===1&&!syncSelectedVehicle()){
    toast('Please select an available vehicle.','error');
    return false;
   }
   for(const field of panel.querySelectorAll('[required]')){
    if(!field.checkValidity()){field.reportValidity();return false;}
   }
   return true;
  }
  function duration(){
   const pickup=new Date(document.getElementById('pickupDate').value+'T00:00:00');
   const returnDate=new Date(document.getElementById('returnDate').value+'T00:00:00');
   return Math.max(1,Math.ceil((returnDate-pickup)/86400000)+1);
  }
  function getData(){
   const data=Object.fromEntries(new FormData(form));
   data.vehicleId=selected.vehicleId;
   data.rentalDays=duration();
   data.dailyRate=Number(selected.dailyRate);
   data.subtotal=data.rentalDays*data.dailyRate;
   data.discount=0;
   data.additionalCharges=0;
   data.totalAmount=data.subtotal;
   return data;
  }
  async function prepareReview(button){
   const pickup=document.getElementById('pickupDate').value;
   const returnDate=document.getElementById('returnDate').value;
   if(returnDate<pickup){toast('Return date cannot be before pickup date.','error');return false;}
   if(Number(document.getElementById('passenger').value)>Number(selected.capacity)){
    toast(`${selected.vehicleName} can carry up to ${selected.capacity} passengers.`,'error');
    return false;
   }
   if(window.SD.config.API_URL){
    try{loading(button,true,'Checking...');await api('CHECK_AVAILABILITY',{vehicleId:selected.vehicleId,pickupDate:pickup,returnDate});}
    catch(error){toast(error.message,'error');return false;}
    finally{loading(button,false);}
   }
   const data=getData();
   document.getElementById('booking-summary').innerHTML=`<div class="summary-card"><h3>Journey details</h3><div class="summary-list"><div class="summary-row"><span>Vehicle</span><strong>${esc(selected.vehicleName)}</strong></div><div class="summary-row"><span>Customer</span><strong>${esc(data.name)}</strong></div><div class="summary-row"><span>Travel date</span><strong>${dateOnly(data.pickupDate)} - ${dateOnly(data.returnDate)}</strong></div><div class="summary-row"><span>Route</span><strong>${esc(data.pickupLocation)} to ${esc(data.dropLocation)}</strong></div><div class="summary-row"><span>Passengers / type</span><strong>${esc(data.passenger)} / ${esc(data.tripType)}</strong></div></div></div><div class="summary-card summary-price"><h3>Price estimate</h3><div class="summary-list"><div class="summary-row"><span>Daily rate</span><strong>${money(data.dailyRate)}</strong></div><div class="summary-row"><span>Rental duration</span><strong>${data.rentalDays} day${data.rentalDays>1?'s':''}</strong></div><div class="summary-row total"><span>Estimated total</span><strong>${money(data.totalAmount)}</strong></div><small style="color:#aeb7c6">Final price may change if extra stops, tolls or special requirements apply.</small></div></div>`;
   return true;
  }
  document.querySelectorAll('.next').forEach(button=>button.addEventListener('click',async()=>{
   if(!validPanel())return;
   if(step===3&&!(await prepareReview(button)))return;
   showStep(step+1);
  }));
  document.querySelectorAll('.prev').forEach(button=>button.addEventListener('click',()=>showStep(step-1)));
  form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(!document.getElementById('terms').checked)return document.getElementById('terms').reportValidity();
   const button=document.getElementById('submit-booking');
   try{
    loading(button,true,'Submitting...');
    const result=await api('CREATE_BOOKING',{booking:getData()});
    form.hidden=true;
    document.querySelector('.steps').hidden=true;
    const success=document.getElementById('booking-success');
    success.hidden=false;
    success.innerHTML=`<div class="success-icon">OK</div><h2>Booking request received</h2><p>Save your booking ID. We will contact you to confirm the journey.</p><div class="booking-id">${esc(result.bookingId)}</div><div class="payment-box"><strong>Payment instruction</strong><p>Please pay the requested deposit only after our team confirms your booking.</p><div class="summary-row"><span>Estimated deposit</span><strong>${money(result.depositAmount)}</strong></div><div class="summary-row"><span>Bank</span><strong>${esc(result.payment.bankName||'Contact us')}</strong></div><div class="summary-row"><span>Account</span><strong>${esc(result.payment.accountNumber||'-')}</strong></div><div class="summary-row"><span>Holder</span><strong>${esc(result.payment.accountHolder||result.payment.businessName||'S&D Express')}</strong></div>${result.payment.duitNowQrUrl?`<img src="${esc(result.payment.duitNowQrUrl)}" alt="DuitNow QR" style="display:block;max-width:180px;margin:18px auto">`:''}<small>Use ${esc(result.bookingId)} as your payment reference and send the receipt through WhatsApp.</small></div><div style="display:flex;justify-content:center;gap:10px;flex-wrap:wrap"><a class="btn btn-primary" href="../track/?id=${encodeURIComponent(result.bookingId)}">Track booking</a><a class="btn btn-outline" href="../">Return home</a></div>`;
    success.scrollIntoView({behavior:'smooth'});
   }catch(error){toast(error.message,'error');}
   finally{loading(button,false);}
  });
  loadVehicles();
 }
 const trackForm=document.getElementById('track-form');
 if(trackForm){
  const param=new URLSearchParams(location.search).get('id');
  if(param)document.getElementById('bookingId').value=param;
  trackForm.addEventListener('submit',async event=>{
   event.preventDefault();
   const button=document.getElementById('track-btn');
   try{
    loading(button,true,'Searching...');
    const booking=await api('TRACK_BOOKING',{bookingId:document.getElementById('bookingId').value.trim().toUpperCase(),phone:document.getElementById('trackPhone').value.trim()});
    const stages=['New Inquiry','Quotation Sent','Waiting Deposit','Payment Review','Confirmed','On Trip','Completed'];
    const index=stages.indexOf(booking.bookingStatus);
    document.getElementById('track-result').innerHTML=`<section class="track-result"><div class="panel-head"><div><span class="eyebrow">${esc(booking.bookingId)}</span><h2 style="margin:8px 0">${esc(booking.vehicleName)}</h2></div><span class="badge status-${esc(booking.bookingStatus).toLowerCase().replaceAll(' ','-')}">${esc(booking.bookingStatus)}</span></div><div class="summary-list"><div class="summary-row"><span>Travel date</span><strong>${dateOnly(booking.pickupDate)} - ${dateOnly(booking.returnDate)}</strong></div><div class="summary-row"><span>Route</span><strong>${esc(booking.pickupLocation)} to ${esc(booking.dropLocation)}</strong></div><div class="summary-row"><span>Estimated amount</span><strong>${money(booking.totalAmount)}</strong></div><div class="summary-row"><span>Payment</span><span class="badge status-${esc(booking.paymentStatus).toLowerCase().replaceAll(' ','-')}">${esc(booking.paymentStatus)}</span></div></div><div class="timeline">${booking.bookingStatus==='Cancelled'?`<div class="timeline-item done"><div><strong>Booking cancelled</strong><small>Please contact us if you need help.</small></div></div>`:stages.map((stage,i)=>`<div class="timeline-item ${i<=index?'done':''}"><div><strong>${stage}</strong><small>${i<=index?'Completed':'Pending'}</small></div></div>`).join('')}</div></section>`;
   }catch(error){document.getElementById('track-result').innerHTML='';toast(error.message,'error');}
   finally{loading(button,false);}
  });
 }
})();