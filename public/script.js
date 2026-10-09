const $ = (s, root=document) => root.querySelector(s);
const money = n => new Intl.NumberFormat('en-LK', { maximumFractionDigits: 0 }).format(Number(n));
let publicData = null, toastTimer;
function toast(message){const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),2800)}
function telegramUrl(message, base){const url=new URL(base || 'https://t.me/HAMBAWAVIP');url.searchParams.set('text',message);return url.toString()}
function openTelegram(message){const base=publicData?.settings?.admin_telegram_url || 'https://t.me/HAMBAWAVIP';window.open(telegramUrl(message,base),'_blank','noopener,noreferrer')}
function offerMarkup(o){
 const expired = o.expiry_date && o.expiry_date < new Date().toISOString().slice(0,10);
 if(!o.active || expired)return '';
 const title=String(o.title), desc=String(o.description||'');
 return `<article class="offer-card"><span class="offer-label">${escapeHtml(title)}</span><h3>${escapeHtml(title)}</h3><p class="offer-description">${escapeHtml(desc||'Premium access offer. Contact the admin for details.')}</p><div class="price-row"><span class="old-price">Rs. ${money(o.original_price)}</span><span class="new-price">Rs. ${money(o.discounted_price)}</span><span class="discount-pill">${Number(o.discount_percent)||0}% OFF</span></div>${o.expiry_date?`<p class="expiry">⌛ Offer ends: ${escapeHtml(o.expiry_date)}</p>`:''}<button class="btn btn-primary offer-buy" data-offer-title="${escapeAttr(title)}">${escapeHtml(o.button_text||'BUY NOW')} ↗</button></article>`;
}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function escapeAttr(s){return escapeHtml(s)}
async function loadPublic(){
 const grid=$('#offersGrid');
 try{
  const r=await fetch('/api/public',{headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error('Unable to load website data');
  publicData=await r.json();const s=publicData.settings;
  document.title=`${s.website_title} | Enter the VIP Experience`;
  $('#membershipPrice').textContent=money(s.default_membership_price);
  $('#mainGroup').href=s.main_group_url;$('#contactAdmin').href=s.admin_telegram_url;$('#ctaContact').href=s.admin_telegram_url;
  $('#contactAdmin').textContent='↗ '+s.contact_button_label;
  const announcement=$('#announcement');
  if(s.homepage_announcement){announcement.textContent=s.homepage_announcement;announcement.classList.remove('hidden')}else announcement.classList.add('hidden');
  grid.innerHTML=s.offer_visibility && publicData.offers.length ? publicData.offers.map(offerMarkup).join('') : '<div class="empty-state"><strong>No active offers right now</strong>Check back soon or contact our admin for membership details.</div>';
 }catch(e){grid.innerHTML='<div class="empty-state"><strong>Offers are temporarily unavailable</strong>Please refresh the page or contact the admin.</div>'}
}
const modal=$('#pricingModal');
function showModal(){modal.classList.remove('hidden');document.body.style.overflow='hidden';$('#closeModal').focus()}
function hideModal(){modal.classList.add('hidden');document.body.style.overflow='';$('#buyVip').focus()}
$('#buyVip').addEventListener('click',showModal);$('#closeModal').addEventListener('click',hideModal);
modal.addEventListener('click',e=>{if(e.target===modal)hideModal()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.classList.contains('hidden'))hideModal()});
$('#buyNow').addEventListener('click',e=>{e.preventDefault();openTelegram('Hi මට VIP එක BUY කරන්න ඕනි')});
$('#offersGrid').addEventListener('click',e=>{const b=e.target.closest('[data-offer-title]');if(!b)return;const title=b.dataset.offerTitle;openTelegram(`Hi මට ${title} එක ගන්න ආවෙ`)});
$('#year').textContent=new Date().getFullYear();
loadPublic();
