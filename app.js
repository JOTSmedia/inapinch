import {escapeHTML as e, distanceMiles, scheduleStatus, filterPlaces, directionsURL} from './logic.js';
import {addIslandMap} from './island-map.js';
import {createOcean} from './ocean.js';
import {initRatings,ratingSummaryHTML,ratingPanelHTML,getRating} from './ratings.js';

const $ = id => document.getElementById(id);
const icon = (name, cls='') => {
  const shapes = {
    bookmark:'<path d="M6 4h12v17l-6-4-6 4z"/>',
    pin:'<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    walk:'<circle cx="14" cy="4" r="2"/><path d="m7 11 4-4 4 3 4 1M10 16l-3 6m5-10-2 4 5 2 2 4M11 7l1 5"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    share:'<path d="M12 16V3m-5 5 5-5 5 5M5 14v7h14v-7"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
    access:'<circle cx="12" cy="4" r="2"/><path d="M11 8v6h6l3 6M11 10l5 1M8 11a6 6 0 1 0 7 9"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    source:'<path d="M14 3h7v7m-1-6-10 10M10 4H4v16h16v-6"/>',
    toilet:'<path d="M5 3h6v8H5zM5 11h15c0 5-3 7-7 7H9c-3 0-4-3-4-7Zm5 7v3h6v-4M18 8v3"/>',
  };
  return `<svg class="ui-icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.pin}</svg>`;
};

let places = [];
let meta = {};
let map;
let markerLayer;
let userMarker;
let userCircle;
let position = null;
let selectedId = null;
let savedOnly = false;
let locating = false;
let filters = new Set();
let markers = new Map();
let view = 'map';
let toastTimeout;
let lastDetailTrigger;
let saved = new Set();
try {
  const value = JSON.parse(localStorage.getItem('in-a-pinch:saved') || '[]');
  if (Array.isArray(value)) saved = new Set(value.filter(x => typeof x === 'string').slice(0,500));
} catch { /* The map also works when browser storage is unavailable. */ }

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { $('toast').classList.remove('visible'); $('toast').hidden = true; }, 4300);
}

const accessLabel = p => ({public:'Free & public',paid:'Admission required',customers:'Purchase likely',unknown:'Check access'})[p.access] || 'Check access';
const accessClass = p => p.access === 'public' ? 'free' : p.access === 'paid' ? 'paid' : 'unknown';
const shortDistance = p => {
  if (!position) return '';
  const mi = distanceMiles(position,p);
  return mi < .1 ? `${Math.max(20,Math.round(mi*5280/20)*20)} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi).toLocaleString()} mi`;
};

function getResults() {
  const results = filterPlaces(places,{query:$('search-input').value,filters,savedOnly,saved});
  const sort = $('sort-select').value;
  if (sort === 'name') results.sort((a,b) => a.name.localeCompare(b.name));
  else if (sort === 'rating') results.sort((a,b) => (getRating(b.id).average ?? -1)-(getRating(a.id).average ?? -1) || getRating(b.id).count-getRating(a.id).count || a.name.localeCompare(b.name));
  else if (sort === 'distance' && position) results.sort((a,b) => distanceMiles(position,a)-distanceMiles(position,b));
  else results.sort((a,b) => (a.access === 'public' ? 0:1)-(b.access === 'public' ? 0:1) || (a.priority ?? 50)-(b.priority ?? 50) || a.name.localeCompare(b.name));
  return results;
}

function render({fit=false}={}) {
  const results = getResults();
  $('result-count').textContent = `${results.length} ${results.length === 1 ? 'mapped stop' : 'mapped stops'}`;
  if ($('map-count')) $('map-count').textContent = `${results.length} on the map`;
  if ($('total-count')) $('total-count').textContent = `${places.length} mapped stops`;
  document.querySelectorAll('#filters [data-filter]').forEach(button => {
    const active = button.dataset.filter === 'all' ? filters.size === 0 : filters.has(button.dataset.filter);
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  });
  if ($('saved-btn')) {
    $('saved-btn').classList.toggle('active',savedOnly);
    $('saved-btn').setAttribute('aria-pressed',String(savedOnly));
    $('saved-btn').setAttribute('aria-label',`${savedOnly?'Show all places':'Show saved places'}${saved.size?` (${saved.size} saved)`:''}`);
    $('saved-btn').innerHTML = `${icon('bookmark')}${saved.size ? `<span class="saved-count">${saved.size}</span>`:''}`;
  }
  if (selectedId && !results.some(p => p.id === selectedId)) closeDetail(false);
  $('result-list').innerHTML = results.length ? results.map(p => {
    const status = scheduleStatus(p);
    return `<article class="result-card ${p.id === selectedId ? 'selected':''}" data-place="${e(p.id)}">
      <div class="card-topline"><span class="place-category">${e(p.category)} <span class="category-separator">·</span> ${e(p.neighborhood)}</span><button class="save-btn ${saved.has(p.id)?'is-saved':''}" data-save="${e(p.id)}" aria-label="${saved.has(p.id)?'Unsave':'Save'} ${e(p.name)}" aria-pressed="${saved.has(p.id)}">${icon('bookmark')}</button></div>
      <button class="card-main" data-select="${e(p.id)}" aria-label="View ${e(p.name)} details"><h3 class="place-name">${e(p.name)}</h3><p class="place-address">${e(p.address)}</p></button>
      <div class="card-tags"><span class="tag tag-${accessClass(p)}">${e(accessLabel(p))}</span>${p.bathroomConfirmed===false?'<span class="tag tag-unconfirmed">Bathroom unconfirmed</span>':''}${p.accessible === true ? `<span class="tag tag-accessible">${icon('access')}Accessible WC</span>`:''}</div>
      ${ratingSummaryHTML(p.id)}
      <div class="card-bottom"><span class="hours-label status-${status.state}">${icon('clock')}${e(status.label)}</span>${position?`<span class="distance-label" title="Straight-line distance, not a walking route">${shortDistance(p)} away</span>`:`<button class="card-detail-link" data-select="${e(p.id)}" aria-label="More details about ${e(p.name)}">Details</button>`}</div>
    </article>`;
  }).join('') : `<div class="empty-state">${icon(savedOnly?'bookmark':'pin')}<h3>${savedOnly ? 'Your next favorite pit stop.' : 'No stops match just yet.'}</h3><p>${savedOnly ? 'Tap a bookmark on any bathroom to save it on this device. Saved places still follow your search and filters.' : filters.has('open') ? 'Only published restroom hours qualify. Unknown hours are excluded. Try removing a filter or search term.' : filters.has('accessible') ? 'This filter only includes specifically documented accessible restrooms. Other places may be accessible; their details are not confirmed.' : 'Try a different place name, neighborhood, or a broader set of filters.'}</p><button class="secondary-action" data-clear>Show all bathrooms</button></div>`;
  updateMarkers(results);
  if (fit && results.length && map) fitResults(results);
  if ($('filter-note')) $('filter-note').textContent = filters.has('open') ? 'Published restroom hours · Key West time · not live availability' : position ? 'Distances are straight-line estimates, not walking routes.' : 'Public facilities first. Tap a stop for access details.';
}

function pinIcon(place) {
  return window.L.divIcon({className:'pin-wrapper',html:`<div class="map-pin ${place.access === 'public'?'public':place.access==='paid'?'paid':'unknown'} ${selectedId===place.id?'selected':''}">${icon('toilet')}</div>`,iconSize:[40,46],iconAnchor:[20,43],tooltipAnchor:[0,-42]});
}

function updateMarkers(results) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers();
  markers.clear();
  results.forEach(place => {
    const marker = window.L.marker([place.lat,place.lng],{icon:pinIcon(place),title:place.name,alt:place.name,keyboard:true,riseOnHover:true,zIndexOffset:selectedId===place.id?500:0});
    marker.bindTooltip(`<strong>${e(place.name)}</strong><span>${e(accessLabel(place))}</span>`,{className:'place-tooltip',direction:'top',offset:[0,-4]});
    marker.on('click',()=>openDetail(place.id,{fromMap:true}));
    markerLayer.addLayer(marker);
    markers.set(place.id,marker);
  });
}

function fitResults(results=places) {
  if (!map || !results.length) return;
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  const mobileTop = Math.min(document.querySelector('.sidebar').getBoundingClientRect().bottom - document.querySelector('.workspace').getBoundingClientRect().top + 62, map.getSize().y * .48);
  map.fitBounds(window.L.latLngBounds(results.map(p=>[p.lat,p.lng])),{paddingTopLeft:[mobile?35:70,mobile?mobileTop:85],paddingBottomRight:[mobile?35:70,mobile?115:85],maxZoom:15,animate:!window.matchMedia('(prefers-reduced-motion: reduce)').matches});
}

async function initializeMap() {
  if (!window.L) {
    $('map-status').hidden = false;
    $('map-status').textContent = 'The map could not load. All bathroom details and directions are available in the list.';
    setView('list');
    return;
  }
  const L = window.L;
  map = L.map('map',{zoomControl:false,minZoom:12,maxZoom:19,zoomSnap:.5,scrollWheelZoom:true,attributionControl:true,maxBounds:[[24.51,-81.855],[24.615,-81.705]],maxBoundsViscosity:.9});
  map.attributionControl.setPrefix(false);
  L.control.zoom({position:'bottomright'}).addTo(map);
  L.control.scale({imperial:true,metric:false,position:'bottomleft',maxWidth:100}).addTo(map);
  fitResults();
  try{
    await addIslandMap(map);
    $('map-status').hidden=true;
  }catch(error){
    const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'}).addTo(map);
    let successes=0;
    tiles.on('tileload',()=>{successes++;$('map-status').hidden=true;});
    tiles.on('tileerror',()=>{if(!successes){$('map-status').hidden=false;$('map-status').textContent='The basemap is unavailable. Bathroom details and walking directions still work in the list.';}});
    console.warn('Using street-map fallback:',error.message);
  }
  markerLayer = L.markerClusterGroup ? L.markerClusterGroup({maxClusterRadius:38,disableClusteringAtZoom:17,showCoverageOnHover:false,spiderfyOnMaxZoom:true,iconCreateFunction:cluster=>L.divIcon({html:`<span>${cluster.getChildCount()}</span>`,className:'pin-cluster',iconSize:[44,44]})}) : L.layerGroup();
  markerLayer.addTo(map);
  fitResults();
  new ResizeObserver(()=>map.invalidateSize({pan:false})).observe($('map'));
}

function renderDetails(place) {
  const status = scheduleStatus(place);
  const coordinateText = place.coordinateAccuracy === 'restroom' ? 'Pin marks a mapped restroom location. Follow signs for the entrance.' : 'Pin marks the facility area, not a surveyed restroom entrance. Follow signs or ask staff on arrival.';
  $('detail-content').innerHTML = `<div class="detail-header"><span class="place-category">${e(place.category)} · ${e(place.neighborhood)}</span><div class="detail-symbol">${icon('toilet')}</div><h2 id="detail-title" class="detail-title">${e(place.name)}</h2><p class="place-address">${icon('pin')}${e(place.address)}</p><div class="card-tags"><span class="tag tag-${accessClass(place)}">${e(accessLabel(place))}</span><span class="tag tag-${status.state}">${e(status.label)}</span></div></div>
    <div class="detail-actions"><a class="primary-action" href="${e(directionsURL(place))}" target="_blank" rel="noopener">${icon('walk')}Walking directions</a><div class="detail-secondary-actions"><button class="secondary-action ${saved.has(place.id)?'is-saved':''}" data-save="${e(place.id)}">${icon('bookmark')}${saved.has(place.id)?'Saved':'Save this stop'}</button><button class="secondary-action" data-share="${e(place.id)}">${icon('share')}Share</button></div><p class="directions-note">Opens Google Maps. ${position?`${shortDistance(place)} away in a straight line.`:'Your starting point is selected in Maps.'}</p></div>
    ${ratingPanelHTML(place.id)}
    <section class="detail-section"><h3>Before you go</h3>${place.bathroomConfirmed===false?'<p class="detail-unconfirmed">Venue listing · Bathroom not yet confirmed</p>':''}<p>${e(place.note)}</p><dl class="detail-meta"><div><dt>Access</dt><dd>${e(place.accessNote || accessLabel(place))}</dd></div><div><dt>Restroom hours</dt><dd>${e(place.hours?.label || 'Not confirmed. Check the source or ask on arrival.')}</dd></div>${place.venueHours?`<div><dt>Venue hours</dt><dd>${e(place.venueHours)}<small>Venue hours do not confirm restroom availability.</small></dd></div>`:''}<div><dt>Wheelchair access</dt><dd>${e(place.accessibilityNote || (place.accessible === true ? 'Accessible restrooms listed by the source.' : 'Restroom accessibility not confirmed.'))}</dd></div><div><dt>Changing table</dt><dd>${place.changingTable === true ? 'Listed by the source.' : 'Not confirmed.'}</dd></div></dl></section>
    <section class="detail-section location-accuracy">${icon('info')}<p>${e(coordinateText)} ${place.hours?.scope === 'restroom' ? 'Schedule status uses Key West time; temporary closures are not monitored.' : ''}</p></section>
    <section class="detail-section"><h3>From the source</h3><p class="source-intro">${place.evidenceType==='osm-venue'?'OpenStreetMap venue listing. Bathroom availability and purchase rules have not been confirmed by the venue.':place.evidenceType==='osm'?'Community-mapped listing. Access and facilities may need confirmation.':'Published facility information. Check with the operator for changes.'}</p><div class="source-links">${place.sources.map(source=>`<a class="source-link" href="${e(source.url)}" target="_blank" rel="noopener">${e(source.label)}${icon('source')}</a>`).join('')}</div><p class="source-checked">Sources reviewed ${e(meta.checkedLabel || 'November 2026')}. Community ratings describe past visits; current availability is not monitored.</p></section>`;
}

function openDetail(id,{fromMap=false,fromLink=false}={}) {
  const place=places.find(p=>p.id===id);
  if(!place)return;
  lastDetailTrigger=document.activeElement;
  selectedId=id;
  $('detail-panel').hidden=false;
  $('detail-panel').classList.add('is-open');
  $('detail-panel').setAttribute('aria-hidden','false');
  $('detail-panel').setAttribute('aria-labelledby','detail-title');
  $('app').classList.add('detail-open');
  renderDetails(place);
  if(fromMap)setView('map');
  document.querySelectorAll('.result-card').forEach(card=>card.classList.toggle('selected',card.dataset.place===id));
  markers.forEach((marker,markerId)=>{ const p=places.find(x=>x.id===markerId); marker.setIcon(pinIcon(p)); marker.setZIndexOffset(markerId===id?500:0); });
  if(map && !fromMap){
    const marker=markers.get(id);
    const focus=()=>{
      const zoom=Math.max(map.getZoom(),16);
      map.setView([place.lat,place.lng],zoom,{animate:false});
      if(window.innerWidth>1000)map.panBy([180,0],{animate:false});
    };
    if(marker && markerLayer.zoomToShowLayer)markerLayer.zoomToShowLayer(marker,focus);else focus();
  }
  const url=new URL(location.href);url.searchParams.set('spot',id);history.replaceState(null,'',url);
  $('detail-panel').scrollTop=0;
  if(!fromLink)$('detail-close').focus({preventScroll:true});
}

function closeDetail(restoreFocus=true) {
  selectedId=null;
  $('detail-panel').hidden=true;
  $('detail-panel').classList.remove('is-open');
  $('detail-panel').setAttribute('aria-hidden','true');
  $('app').classList.remove('detail-open');
  document.querySelectorAll('.result-card.selected').forEach(c=>c.classList.remove('selected'));
  markers.forEach((marker,id)=>marker.setIcon(pinIcon(places.find(p=>p.id===id))));
  const url=new URL(location.href);url.searchParams.delete('spot');history.replaceState(null,'',url);
  if(restoreFocus && lastDetailTrigger?.isConnected)lastDetailTrigger.focus({preventScroll:true});
}

function toggleSaved(id) {
  const inDetail=$('detail-content').contains(document.activeElement);
  saved.has(id)?saved.delete(id):saved.add(id);
  let persisted=true;
  try{localStorage.setItem('in-a-pinch:saved',JSON.stringify([...saved]));}catch{persisted=false;}
  render();
  if(selectedId===id)renderDetails(places.find(p=>p.id===id));
  const replacement=(inDetail?$('detail-content'):$('result-list')).querySelector(`[data-save="${CSS.escape(id)}"]`);
  if(replacement)replacement.focus({preventScroll:true});else $('saved-btn').focus({preventScroll:true});
  toast(saved.has(id)?persisted?'Saved on this device.':'Saved for this session. Browser storage is unavailable.':'Removed from your saved spots.');
}

async function sharePlace(id) {
  const place=places.find(p=>p.id===id);
  const url=new URL(location.href);url.searchParams.set('spot',id);
  try{
    if(navigator.share)await navigator.share({title:`${place.name} · IN A PINCH`,text:'when you gotta go, you gotta go',url:url.href});
    else {await navigator.clipboard.writeText(url.href);toast('Bathroom link copied.');}
  }catch(error){
    if(error.name==='AbortError')return;
    toast('Copy the address from your browser to share this stop.');
  }
}

function setView(next) {
  view=next;
  $('app').dataset.view=next;
  $('app').classList.toggle('view-list',next==='list');
  $('app').classList.toggle('view-map',next==='map');
  $('map-view-btn').classList.toggle('active',next==='map');
  $('list-view-btn').classList.toggle('active',next==='list');
  $('map-view-btn').setAttribute('aria-pressed',String(next==='map'));
  $('list-view-btn').setAttribute('aria-pressed',String(next==='list'));
  if(map)requestAnimationFrame(()=>map.invalidateSize({pan:false}));
}

function locate() {
  if(locating)return;
  if(!navigator.geolocation){toast('Location is unavailable in this browser. Search a street or place instead.');return;}
  locating=true;
  $('locate-btn').disabled=true;
  $('locate-btn').setAttribute('aria-busy','true');
  $('location-status').textContent='Waiting for your location…';
  const finish=()=>{locating=false;$('locate-btn').disabled=false;$('locate-btn').removeAttribute('aria-busy');};
  navigator.geolocation.getCurrentPosition(result=>{
    finish();
    position={lat:result.coords.latitude,lng:result.coords.longitude};
    $('sort-select').value='distance';
    const mi=distanceMiles(position,{lat:24.558,lng:-81.782});
    $('location-status').textContent=mi>15?'You’re outside Key West. Results are sorted by your distance.':`Using your location · accuracy about ${Math.max(1,Math.round(result.coords.accuracy*3.28084))} ft`;
    if(map && mi<15){
      if(userMarker)map.removeLayer(userMarker);
      if(userCircle)map.removeLayer(userCircle);
      userMarker=window.L.marker([position.lat,position.lng],{icon:window.L.divIcon({className:'user-location-marker',html:'<span class="user-location-dot"></span>',iconSize:[22,22],iconAnchor:[11,11]}),title:'Your approximate location',zIndexOffset:1500}).addTo(map);
      userCircle=window.L.circle([position.lat,position.lng],{radius:Math.min(result.coords.accuracy,2000),color:'#2b75d6',fillOpacity:.06,weight:1,interactive:false}).addTo(map);
    }
    render();
    const results=getResults();
    if(map && results.length && mi<15){
      map.fitBounds(window.L.latLngBounds([[position.lat,position.lng],...results.slice(0,3).map(p=>[p.lat,p.lng])]),{padding:[70,95],maxZoom:17});
    }
    if(mi>15)toast('Showing Key West bathrooms, sorted from your current location.');
    else if(results.length)toast(`Closest match: ${results[0].name}. Check its access and hours.`);
  },error=>{
    finish();
    const message=error.code===1?'Location permission is off. Enable it in your browser, or search a street or place.':error.code===3?'Location took too long. Try again, or search a street or place.':'Your location couldn’t be found. Try again, or search a street or place.';
    $('location-status').textContent=message;
    if($('sort-select').value==='distance')$('sort-select').value='recommended';
    toast(message);
  },{enableHighAccuracy:true,timeout:12000,maximumAge:120000});
}

function clearFilters() {
  filters.clear();savedOnly=false;$('search-input').value='';closeDetail(false);render({fit:true});
}

function bindEvents() {
  $('search-input').addEventListener('input',()=>render({fit:true}));
  $('filters').addEventListener('click',event=>{
    const button=event.target.closest('[data-filter]');if(!button)return;
    const value=button.dataset.filter;
    if(value==='all')filters.clear();else{if(value==='free')filters.delete('purchase');if(value==='purchase')filters.delete('free');filters.has(value)?filters.delete(value):filters.add(value);}
    render({fit:true});
  });
  $('sort-select').addEventListener('change',()=>{if($('sort-select').value==='distance'&&!position)locate();else render();});
  $('saved-btn')?.addEventListener('click',()=>{savedOnly=!savedOnly;render({fit:true});if(savedOnly)setView('list');});
  $('locate-btn').addEventListener('click',locate);
  $('reset-map-btn').addEventListener('click',()=>{closeDetail(false);fitResults(getResults());setView('map');});
  $('map-view-btn').addEventListener('click',()=>setView('map'));
  $('list-view-btn').addEventListener('click',()=>setView('list'));
  $('detail-close').addEventListener('click',()=>closeDetail());
  $('about-btn').addEventListener('click',()=>{$('about-dialog').showModal();});
  $('about-close').addEventListener('click',()=>{$('about-dialog').close();});
  $('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=$('about-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('about-dialog').close();}});
  document.addEventListener('click',event=>{
    const saveButton=event.target.closest('[data-save]');if(saveButton){toggleSaved(saveButton.dataset.save);return;}
    const selectButton=event.target.closest('[data-select]');if(selectButton){openDetail(selectButton.dataset.select);return;}
    const shareButton=event.target.closest('[data-share]');if(shareButton){sharePlace(shareButton.dataset.share);return;}
    if(event.target.closest('[data-clear]'))clearFilters();
    const card=event.target.closest('.result-card');
    if(card && !event.target.closest('button,a,input,select'))openDetail(card.dataset.place);
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && selectedId && !$('about-dialog').open)closeDetail();
    if(event.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName) && !$('about-dialog').open){event.preventDefault();$('search-input').focus();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){render();if(selectedId)renderDetails(places.find(p=>p.id===selectedId));}});
  setInterval(()=>{
    if(document.hidden || $('result-list').contains(document.activeElement) || $('detail-panel').contains(document.activeElement))return;
    render();if(selectedId)renderDetails(places.find(p=>p.id===selectedId));
  },60000);
}

async function start() {
  bindEvents();
  createOcean();
  new ResizeObserver(()=>{
    const top=document.querySelector('.sidebar').getBoundingClientRect().bottom-document.querySelector('.workspace').getBoundingClientRect().top+12;
    $('app').style.setProperty('--mobile-controls-top',`${top}px`);
  }).observe(document.querySelector('.sidebar'));
  try{
    const response=await fetch('./locations.json');
    if(!response.ok)throw new Error('Location data unavailable');
    const data=await response.json();meta=data.meta;places=data.locations;
    if(!Array.isArray(places)||!places.length)throw new Error('No location data');
    saved=new Set([...saved].filter(id=>places.some(p=>p.id===id)));
    await initializeMap();render();setView(map?'map':'list');
    void initRatings(()=>{render();if(selectedId)renderDetails(places.find(p=>p.id===selectedId));},toast);
    const id=new URL(location.href).searchParams.get('spot');
    if(id && places.some(p=>p.id===id))openDetail(id,{fromLink:true});
    if($('checked-date'))$('checked-date').textContent=meta.checkedLabel || 'November 2026';
  }catch(error){
    setView('list');
    $('result-count').textContent='The directory couldn’t load';
    $('result-list').innerHTML='<div class="empty-state"><h3>A small detour.</h3><p>Please refresh to load the bathroom directory.</p><button class="secondary-action" id="reload-btn">Try again</button></div>';
    $('reload-btn').addEventListener('click',()=>location.reload());
    $('map-status').hidden=false;$('map-status').textContent='Please refresh to try loading the map again.';
    console.error(error);
  }
}
start();
