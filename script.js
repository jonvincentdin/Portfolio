(function(){
  "use strict";

  /* ============ Constants ============ */
  const FIXED_SECTIONS = [
    {key:"home", label:"Home"},
    {key:"achievements", label:"Achievements & Education"},
    {key:"projects", label:"Projects"},
    {key:"skills", label:"Skills"},
    {key:"experience", label:"Experience"},
    {key:"contact", label:"Contact"}
  ];
  const SOCIAL_TYPES = ["github","linkedin","twitter","instagram","email","website","youtube","behance","dribbble","other"];
  const PREFS_KEY = "portfolio_prefs_v1";

  /* ============ State ============ */
  let data = null;        // live portfolio content, backed by the server (Vercel Blob via /api/data)
  let authState = {hasPassword:false, authenticated:false};
  let prefs = {theme:"paper", size:"md"};
  let state = { editing:false, section:"home" };

  const page = document.getElementById("page");
  const modalRoot = document.getElementById("modal-root");
  const toastRoot = document.getElementById("toast-root");

  function uid(){ return "id_" + Math.random().toString(36).slice(2,10); }
  function esc(str){ return String(str==null?"":str).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  function nl2br(str){ return esc(str).replace(/\n/g,"<br>"); }
  function getInitials(name){
    if(!name || !name.trim()) return "?";
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if(parts.length===1) return parts[0].slice(0,2).toUpperCase();
    return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
  }

  /* ============ Reordering ============ */
  function moveInArray(arr, id, dir){
    if(!arr) return;
    const idx = arr.findIndex(x=>x.id===id);
    if(idx<0) return;
    const swapIdx = idx + dir;
    if(swapIdx<0 || swapIdx>=arr.length) return;
    [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
  }
  function moveButtons(listKey, id, parentId, idx, length){
    const upDisabled = idx===0, downDisabled = idx===length-1;
    const parentAttr = parentId ? `data-parent-id="${esc(parentId)}"` : '';
    return `<button class="textlink" data-action="move-item" data-list="${listKey}" data-id="${id}" data-dir="up" ${parentAttr} ${upDisabled?'disabled style="opacity:.3;"':''} title="Move up">↑</button>
      <button class="textlink" data-action="move-item" data-list="${listKey}" data-id="${id}" data-dir="down" ${parentAttr} ${downDisabled?'disabled style="opacity:.3;"':''} title="Move down">↓</button>`;
  }

  /* ============ Certificate reveal (accordion) ============ */
  function renderCertTrigger(item){
    const hasFile = item.certFileUrl;
    if(!item.certLink && !item.certImage && !hasFile) return "";
    const fileDownloadAttr = hasFile && item.certFileUrl.startsWith("data:") ? `download="${esc(item.certFileLabel||'file')}"` : '';
    const linkRow = (item.certLink || hasFile) ? `<div class="cert-links">
        ${item.certLink?`<a class="cert-link" href="${esc(item.certLink)}" target="_blank" rel="noopener">Open link ↗</a>`:''}
        ${hasFile?`<a class="cert-link" href="${esc(item.certFileUrl)}" target="_blank" rel="noopener" ${fileDownloadAttr}>${esc(item.certFileLabel || "Download file")} ↓</a>`:''}
      </div>` : '';
    return `<button class="cert-trigger" data-action="toggle-cert" data-id="${item.id}">
      <span class="cert-trigger-label">Additional links</span>
      <span class="cert-chevron">⌄</span>
    </button>
    <div class="cert-box" id="certbox-${item.id}">
      <div class="cert-box-inner">
        ${item.certImage?`<img class="cert-image" src="${esc(item.certImage)}" alt="Attached photo">`:''}
        ${linkRow}
      </div>
    </div>`;
  }
  function toggleCertBox(id){
    const box = document.getElementById("certbox-"+id);
    const trigger = document.querySelector(`.cert-trigger[data-id="${id}"]`);
    if(!box) return;
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isOpen = box.classList.contains("open");
    const img = box.querySelector("img");
    const measure = ()=>{ box.style.maxHeight = box.scrollHeight + "px"; };
    if(isOpen){
      if(!reduceMotion){
        box.style.maxHeight = box.scrollHeight + "px";
        requestAnimationFrame(()=>{ box.style.maxHeight = "0px"; });
      } else {
        box.style.maxHeight = "0px";
      }
      box.classList.remove("open");
      if(trigger) trigger.classList.remove("open");
    } else {
      box.classList.add("open");
      if(trigger) trigger.classList.add("open");
      if(reduceMotion){
        box.style.maxHeight = "none";
      } else if(img && !img.complete){
        measure();
        img.addEventListener("load", measure, {once:true});
      } else {
        measure();
      }
    }
  }
  function showToast(msg, isError){
    const el = document.createElement("div");
    el.className = "toast" + (isError ? " error" : "");
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(()=>{ el.remove(); }, 2800);
  }

  function openMailClient(to, subject, body){
    const a = document.createElement("a");
    a.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    a.click();
  }

  async function copyText(text){
    try{
      if(navigator.clipboard && navigator.clipboard.writeText){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(e){ /* fall through */ }
    try{
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.top = "-1000px"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }catch(e){ return false; }
  }

  function downloadVCard(){
    const p = data.profile || {};
    const c = data.contact || {};
    const lines = ["BEGIN:VCARD","VERSION:3.0", `FN:${p.name||"Contact"}`];
    if(p.title) lines.push(`TITLE:${p.title}`);
    if(c.email) lines.push(`EMAIL:${c.email}`);
    if(c.phone) lines.push(`TEL:${c.phone}`);
    if(c.location) lines.push(`ADR:;;${c.location};;;;`);
    lines.push("END:VCARD");
    downloadBlob(lines.join("\n"), `${(p.name||"contact").replace(/[^a-z0-9]+/gi,"-")}.vcf`, "text/vcard");
  }

  function downloadBlob(content, filename, mime){
    const blob = new Blob([content], {type:mime || "application/octet-stream"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url), 2000);
  }

  function blobToBase64(blob){
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error("read failed"));
      reader.onload = ()=>{
        const result = reader.result;
        const commaIdx = result.indexOf(",");
        resolve(commaIdx>=0 ? result.slice(commaIdx+1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  async function uploadToServer(blob, filename, contentType){
    const dataBase64 = await blobToBase64(blob);
    const res = await fetch("/api/upload", {
      method:"POST",
      credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({filename, contentType, dataBase64})
    });
    if(!res.ok){
      const err = await res.json().catch(()=>({}));
      throw new Error(err.error || "Upload failed.");
    }
    const json = await res.json();
    return json.url;
  }

  // Uploads an arbitrary file as-is (used for the certificate/attachment "file" slot).
  async function uploadRawFile(file){
    return uploadToServer(file, file.name, file.type || "application/octet-stream");
  }

  // Resizes an image client-side (to keep uploads small and fast) then uploads
  // the result to Vercel Blob, returning the resulting public URL.
  function uploadImageFile(file, maxDim, quality){
    maxDim = maxDim || 1400; quality = quality || 0.85;
    return new Promise((resolve, reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error("read failed"));
      reader.onload = ()=>{
        const img = new Image();
        img.onerror = ()=>reject(new Error("decode failed"));
        img.onload = ()=>{
          let w = img.width, h = img.height;
          if(w > maxDim || h > maxDim){
            if(w >= h){ h = Math.round(h * (maxDim / w)); w = maxDim; }
            else { w = Math.round(w * (maxDim / h)); h = maxDim; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const isPng = /png/i.test(file.type) && file.size < 300000;
          const mime = isPng ? "image/png" : "image/jpeg";
          canvas.toBlob(async (blob)=>{
            if(!blob){ reject(new Error("couldn't process image")); return; }
            try{
              const baseName = (file.name || "photo").replace(/\.[^.]+$/, "");
              const ext = isPng ? "png" : "jpg";
              const url = await uploadToServer(blob, `${baseName}.${ext}`, mime);
              resolve(url);
            }catch(err){ reject(err); }
          }, mime, quality);
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /* ============ Persistence ============ */
  function defaultData(){
    return {
      profile:{name:"Your Name", title:"", description:"", photo:"", socials:[]},
      achievements:[], education:[], skills:[], experience:[], projectCategories:[], projectPhotoSize:"M",
      contact:{email:"", phone:"", location:"", availability:"", preferred:"", resumeUrl:"", blurb:"", links:[]},
      customSections:[], hiddenSections:[], sectionOrder:[]
    };
  }
  function migrateProjects(obj){
    if(!obj.projectCategories){
      if(Array.isArray(obj.projects) && obj.projects.length){
        obj.projectCategories = [{id:uid(), title:"Projects", projects:obj.projects}];
      } else {
        obj.projectCategories = [];
      }
    }
    delete obj.projects;
  }

  function ensureSectionOrder(){
    const allKeys = FIXED_SECTIONS.map(s=>s.key).concat(data.customSections.map(cs=>"custom:"+cs.id));
    if(!Array.isArray(data.sectionOrder)) data.sectionOrder = [];
    data.sectionOrder = data.sectionOrder.filter(k=>allKeys.includes(k));
    allKeys.forEach(k=>{ if(!data.sectionOrder.includes(k)) data.sectionOrder.push(k); });
  }
  function getOrderedSectionMeta(){
    ensureSectionOrder();
    return data.sectionOrder.map(key=>{
      if(key.startsWith("custom:")){
        const cs = data.customSections.find(c=>c.id===key.slice(7));
        return cs ? {key, label:cs.title, isCustom:true} : null;
      }
      const fs = FIXED_SECTIONS.find(s=>s.key===key);
      return fs ? {key, label:fs.label, isCustom:false} : null;
    }).filter(Boolean);
  }

  async function loadAll(){
    try{
      const res = await fetch("/api/data", {credentials:"same-origin", cache:"no-store"});
      data = res.ok ? await res.json() : defaultData();
    }catch(e){ data = defaultData(); }
    if(!data.customSections) data.customSections = [];
    if(!data.hiddenSections) data.hiddenSections = [];
    if(!data.sectionOrder) data.sectionOrder = [];
    if(!data.contact) data.contact = defaultData().contact;
    if(!data.contact.links) data.contact.links = [];
    if(!data.profile) data.profile = defaultData().profile;
    if(!data.projectPhotoSize) data.projectPhotoSize = "M";
    migrateProjects(data);

    try{
      const res = await fetch("/api/auth", {credentials:"same-origin", cache:"no-store"});
      authState = res.ok ? await res.json() : {hasPassword:false, authenticated:false};
    }catch(e){ authState = {hasPassword:false, authenticated:false}; }
    state.editing = !!authState.authenticated;

    try{
      const raw = localStorage.getItem(PREFS_KEY);
      if(raw) prefs = Object.assign({theme:"paper", size:"md"}, JSON.parse(raw));
    }catch(e){ /* defaults are fine */ }
    applyPrefs();
  }

  async function saveData(){
    try{
      const res = await fetch("/api/data", {
        method:"POST", credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify(data)
      });
      if(!res.ok){
        const err = await res.json().catch(()=>({}));
        if(res.status === 401){
          showToast("Your edit session expired — click your name to unlock again.", true);
          state.editing = false; render();
        } else {
          showToast(err.error || "Couldn't save — try again.", true);
        }
        return false;
      }
      return true;
    }catch(e){ showToast("Couldn't save — check your connection.", true); return false; }
  }
  function savePrefs(){
    try{ localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }
    catch(e){ /* non-critical */ }
  }
  function applyPrefs(){
    document.documentElement.setAttribute("data-theme", prefs.theme);
    document.documentElement.setAttribute("data-size", prefs.size);
  }
  function persistAndRender(){ render(); saveData(); }

  /* ============ Render root ============ */
  function render(){
    const editing = state.editing;
    if(!editing && data.hiddenSections.includes(state.section)){ state.section = "home"; }

    let html = "";
    html += renderSiteHeader(editing);
    html += renderTopbar(editing);
    if(editing) html += renderEditbar();

    html += `<nav class="tabs-row" role="tablist">`;
    getOrderedSectionMeta().forEach(s=>{
      const hidden = !s.isCustom && data.hiddenSections.includes(s.key);
      if(hidden && !editing) return;
      html += `<button class="tab ${state.section===s.key?'active':''}" role="tab" data-action="nav" data-section="${s.key}" style="${hidden?'opacity:.45;':''}">${esc(s.label)}${hidden?' <span class="mono" style="font-size:.62rem;">(hidden)</span>':''}</button>`;
    });
    if(editing){ html += `<button class="tab add-tab" data-action="add-section">+ Section</button>`; }
    html += `</nav>`;

    html += `<main class="stage">`;
    if(state.section.startsWith("custom:")){
      const id = state.section.slice(7);
      const cs = data.customSections.find(c=>c.id===id);
      html += cs ? renderCustomSection(cs, editing) : `<div class="empty-state">This section was removed.</div>`;
    } else {
      switch(state.section){
        case "home": html += renderHome(editing); break;
        case "achievements": html += renderAchievements(editing); break;
        case "projects": html += renderProjects(editing); break;
        case "skills": html += renderSkills(editing); break;
        case "experience": html += renderExperience(editing); break;
        case "contact": html += renderContact(editing); break;
      }
    }
    html += `</main>`;
    html += `<footer class="pagefoot">Portfolio</footer>`;
    page.innerHTML = html;
  }

  function renderSiteHeader(editing){
    const name = (data.profile && data.profile.name) ? data.profile.name : "Portfolio";
    return `<div class="sitehead">
      <button class="brandname ${editing?'is-editing':''}" data-action="toggle-edit" title="${editing ? 'Exit edit mode' : 'Click to edit this portfolio'}">
        ${esc(name)}${editing?'<span class="caret">editing…</span>':''}
      </button>
    </div>`;
  }

  function renderTopbar(editing){
    const themes = [["paper","Paper"],["light","Light"],["sepia","Sepia"],["dark","Dark"]];
    const sizes = [["sm","S"],["md","M"],["lg","L"],["xl","XL"]];
    return `
    <div class="toprow">
      <div class="prefs">
        <span class="prefs-label">Theme</span>
        <div class="prefs-group" role="group" aria-label="Theme">
          ${themes.map(t=>`<button data-action="set-theme" data-value="${t[0]}" class="${prefs.theme===t[0]?'active':''}">${t[1]}</button>`).join("")}
        </div>
        <span class="prefs-label">Text size</span>
        <div class="prefs-group size" role="group" aria-label="Text size">
          ${sizes.map((t,i)=>`<button data-action="set-size" data-value="${t[0]}" class="${prefs.size===t[0]?'active':''}" style="font-size:${0.72+i*0.14}rem;">${t[1]}</button>`).join("")}
        </div>
      </div>
    </div>`;
  }

  function renderEditbar(){
    let html = `<div class="editbar">`;
    html += `<span>You're editing — changes save automatically for everyone.</span>`;
    html += `<button class="linklike" data-action="manage-sections">Manage sections</button>`;
    html += `<button class="linklike" data-action="change-password">Change password</button>`;
    html += `<button class="linklike" data-action="logout">Log out</button>`;
    html += `</div>`;
    return html;
  }

  /* ============ HOME ============ */
  function renderHome(editing){
    const p = data.profile;
    let html = `<div class="home-hero"><div class="home-top">`;
    html += renderPhotoFrame(p, editing);
    html += `<div class="home-textcol">`;
    if(editing){
      html += `<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:2px;">
        <button class="btn ghost sm" data-action="edit-profile">Edit intro</button>
        <button class="btn ghost sm" data-action="edit-socials">Edit links</button>
      </div>`;
    }
    html += `<h1 class="home-name">${esc(p.name)}</h1>`;
    if(p.title) html += `<div class="home-title">${esc(p.title)}</div>`;
    if(p.description) html += `<p class="home-desc">${nl2br(p.description)}</p>`;
    html += `<div class="socials-row">`;
    if(!p.socials || p.socials.length===0){
      html += editing ? `<span class="hint" style="margin:0;">No links yet — add as many as you like with "Edit links".</span>` : "";
    } else {
      p.socials.forEach(s=>{ html += `<a class="social-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`; });
    }
    html += `</div></div></div></div>`;
    return html;
  }

  function renderPhotoFrame(p, editing){
    const inner = p.photo ? `<img src="${esc(p.photo)}" alt="${esc(p.name)}">` : `<div class="photo-placeholder">${esc(getInitials(p.name))}</div>`;
    let html = `<div class="home-photo-wrap"><div class="home-photo">${inner}</div>`;
    if(editing){
      html += `<div class="photo-actions">
        <label class="btn ghost sm" for="profile_photo_file" style="cursor:pointer;">${p.photo ? "Change photo" : "Add photo"}</label>
        ${p.photo ? `<button class="btn ghost sm" data-action="remove-photo" style="border-color:var(--danger); color:var(--danger);">Remove</button>` : ""}
        <input type="file" id="profile_photo_file" accept="image/*" style="display:none;">
      </div>`;
    }
    html += `</div>`;
    return html;
  }

  /* ============ ACHIEVEMENTS & EDUCATION ============ */
  function renderAchievements(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Record</span><h2>Achievements & Education</h2></div></div>`;
    html += `<div class="subhead"><h3>Achievements</h3>${editing?'<button class="btn sm accent" data-action="add-achievement">+ Add</button>':''}</div>`;
    html += renderRecordList(data.achievements, "achievement", editing);
    html += `<div class="subhead"><h3>Education</h3>${editing?'<button class="btn sm accent" data-action="add-education">+ Add</button>':''}</div>`;
    html += renderRecordList(data.education, "education", editing);
    return html;
  }
  function renderRecordList(list, kind, editing){
    if(!list || list.length===0){
      return `<div class="empty-state">${editing ? "Nothing here yet — add the first entry above." : "Nothing added yet."}</div>`;
    }
    let html = "";
    list.forEach((item, idx)=>{
      html += `<div class="entry">
        <div class="entry-top">
          <div>
            <div class="entry-title">${esc(item.title)}</div>
            <div class="entry-meta">${esc(item.org)}${item.org && item.date ? " · " : ""}${esc(item.date)}</div>
          </div>
          ${editing?`<div class="entry-actions">
            ${moveButtons(kind==="achievement"?"achievements":"education", item.id, null, idx, list.length)}
            <button class="textlink" data-action="edit-${kind}" data-id="${item.id}">Edit</button>
            <button class="textlink danger" data-action="delete-${kind}" data-id="${item.id}">Delete</button>
          </div>`:''}
        </div>
        ${item.description ? `<div class="entry-desc">${nl2br(item.description)}</div>` : ""}
        ${renderCertTrigger(item)}
      </div>`;
    });
    return html;
  }

  /* ============ PROJECTS ============ */
  function renderProjects(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Build log</span><h2>Projects</h2></div>${editing?'<button class="btn accent" data-action="add-project-category">+ Add category</button>':''}</div>`;
    if(editing){
      const sizes = ["S","M","L"];
      const current = data.projectPhotoSize || "M";
      html += `<div class="prefs" style="margin-bottom:22px;">
        <span class="prefs-label">Photo size</span>
        <div class="prefs-group" role="group" aria-label="Project photo size">
          ${sizes.map(s=>`<button data-action="set-project-photo-size" data-value="${s}" class="${current===s?'active':''}">${s}</button>`).join("")}
        </div>
      </div>`;
    }
    if(!data.projectCategories || data.projectCategories.length===0){
      html += `<div class="empty-state">${editing ? 'No categories yet — add one above (e.g. "Web Apps", "Client Work").' : "Projects are on their way — check back soon."}</div>`;
      return html;
    }
    data.projectCategories.forEach((cat, catIdx)=>{
      html += `<div class="group">
        <div class="group-head">
          <h3>${esc(cat.title)}</h3>
          ${editing?`<div class="group-actions">
            ${moveButtons("projectCategories", cat.id, null, catIdx, data.projectCategories.length)}
            <button class="textlink" data-action="edit-project-category" data-id="${cat.id}">Rename</button>
            <button class="textlink" data-action="add-project" data-id="${cat.id}">+ Add project</button>
            <button class="textlink danger" data-action="delete-project-category" data-id="${cat.id}">Delete category</button>
          </div>`:''}
        </div>`;
      if(!cat.projects || cat.projects.length===0){
        html += `<div class="empty-state">${editing?"No projects yet in this category.":"Nothing here yet."}</div>`;
      } else {
        cat.projects.forEach((pr, prIdx)=>{ html += renderProjectCard(pr, editing, cat.id, prIdx, cat.projects.length); });
      }
      html += `</div>`;
    });
    return html;
  }
  function renderProjectCard(pr, editing, categoryId, idx, length){
    return `<div class="project">
      <div class="project-head">
        <h3>${esc(pr.header)}</h3>
        ${editing?`<div class="entry-actions">
          ${moveButtons("projects", pr.id, categoryId, idx, length)}
          <button class="textlink" data-action="edit-project" data-id="${pr.id}" data-section-id="${categoryId}">Edit</button>
          <button class="textlink danger" data-action="delete-project" data-id="${pr.id}" data-section-id="${categoryId}">Delete</button>
        </div>`:''}
      </div>
      ${pr.description?`<p class="entry-desc" style="margin-top:6px;">${nl2br(pr.description)}</p>`:''}
      ${(pr.tags&&pr.tags.length)?`<div style="margin-top:8px;">${pr.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join("")}</div>`:''}
      ${renderProjectLinksAndFiles(pr)}
      ${renderProjectImages(pr)}
    </div>`;
  }
  function renderProjectLinksAndFiles(pr){
    const all = [...(pr.links||[]), ...(pr.files||[]).map(f=>({...f, type:"download"}))];
    if(all.length===0) return "";
    const linksHtml = all.map(l=>{
      const badge = l.type === "download" ? "Download ↓" : (l.type === "github" ? "GitHub ↗" : (l.type === "live" || l.type==="demo" ? "Live ↗" : "Link ↗"));
      return `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || badge)}</a>`;
    }).join("");
    return `<button class="cert-trigger" data-action="toggle-cert" data-id="${pr.id}">
      <span class="cert-trigger-label">Links & files (${all.length})</span>
      <span class="cert-chevron">⌄</span>
    </button>
    <div class="cert-box" id="certbox-${pr.id}">
      <div class="cert-box-inner">
        <div class="cert-links">${linksHtml}</div>
      </div>
    </div>`;
  }
  function renderProjectImages(pr){
    if(!pr.images || pr.images.length===0) return "";
    const sizeClass = "size-" + (data.projectPhotoSize || "M").toLowerCase();
    let html = `<div class="project-images ${sizeClass}">`;
    pr.images.forEach(img=>{
      html += `<figure><img src="${esc(img.url)}" alt="${esc(img.caption||pr.header)}" loading="lazy">${img.caption?`<figcaption>${esc(img.caption)}</figcaption>`:''}</figure>`;
    });
    html += `</div>`;
    return html;
  }

  /* ============ SKILLS ============ */
  function renderSkills(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Toolkit</span><h2>Skills</h2></div>${editing?'<button class="btn accent" data-action="add-skill">+ Add category</button>':''}</div>`;
    if(!data.skills || data.skills.length===0){
      html += `<div class="empty-state">${editing?"No skill categories yet — add one above.":"Nothing added yet."}</div>`;
      return html;
    }
    data.skills.forEach((cat, idx)=>{
      html += `<div class="entry">
        <div class="entry-top">
          <div class="entry-title" style="font-size:1rem;">${esc(cat.category)}</div>
          ${editing?`<div class="entry-actions">
            ${moveButtons("skills", cat.id, null, idx, data.skills.length)}
            <button class="textlink" data-action="edit-skill" data-id="${cat.id}">Edit</button>
            <button class="textlink danger" data-action="delete-skill" data-id="${cat.id}">Delete</button>
          </div>`:''}
        </div>
        <div style="margin-top:8px;">${(cat.items||[]).map(i=>`<span class="tag">${esc(i)}</span>`).join("") || '<span class="hint" style="margin:0;">No skills listed.</span>'}</div>
      </div>`;
    });
    return html;
  }

  /* ============ EXPERIENCE ============ */
  function renderExperience(editing){
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Track record</span><h2>Experience</h2></div>${editing?'<button class="btn accent" data-action="add-exp-section">+ Add section</button>':''}</div>`;
    if(!data.experience || data.experience.length===0){
      html += `<div class="empty-state">${editing?'No sections yet — add one above (e.g. "Work Experience").':"Nothing added yet."}</div>`;
      return html;
    }
    data.experience.forEach((sec, secIdx)=>{
      html += `<div class="group">
        <div class="group-head">
          <h3>${esc(sec.sectionTitle)}</h3>
          ${editing?`<div class="group-actions">
            ${moveButtons("experience", sec.id, null, secIdx, data.experience.length)}
            <button class="textlink" data-action="edit-exp-section" data-id="${sec.id}">Rename</button>
            <button class="textlink" data-action="add-exp-item" data-id="${sec.id}">+ Add item</button>
            <button class="textlink danger" data-action="delete-exp-section" data-id="${sec.id}">Delete section</button>
          </div>`:''}
        </div>`;
      if(!sec.items || sec.items.length===0){
        html += `<div class="empty-state">${editing?"No items yet in this section.":"Nothing here yet."}</div>`;
      } else {
        sec.items.forEach((item, itemIdx)=>{
          html += `<div class="entry">
            <div class="entry-top">
              <div>
                <div class="entry-title" style="font-size:1rem;">${esc(item.title)}</div>
                <div class="entry-meta">${esc(item.subtitle)}${item.subtitle && item.date ? " · " : ""}${esc(item.date)}</div>
              </div>
              ${editing?`<div class="entry-actions">
                ${moveButtons("expItems", item.id, sec.id, itemIdx, sec.items.length)}
                <button class="textlink" data-action="edit-exp-item" data-id="${item.id}" data-section-id="${sec.id}">Edit</button>
                <button class="textlink danger" data-action="delete-exp-item" data-id="${item.id}" data-section-id="${sec.id}">Delete</button>
              </div>`:''}
            </div>
            ${item.description?`<div class="entry-desc">${nl2br(item.description)}</div>`:''}
          </div>`;
        });
      }
      html += `</div>`;
    });
    return html;
  }

  /* ============ CUSTOM SECTIONS ============ */
  function renderCustomSection(cs, editing){
    let html = `<div class="section-heading">
      <div><span class="section-eyebrow">Custom section</span><h2>${esc(cs.title)}</h2></div>
      ${editing?`<div class="group-actions">
        <button class="btn ghost sm" data-action="rename-section" data-id="${cs.id}">Rename</button>
        <button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="delete-section" data-id="${cs.id}">Delete section</button>
      </div>`:''}
    </div>`;
    if(editing){ html += `<button class="btn ghost sm" data-action="edit-section-intro" data-id="${cs.id}" style="margin-bottom:14px;">${cs.intro ? "Edit intro text" : "+ Add intro text"}</button>`; }
    if(cs.intro) html += `<p class="intro-text">${nl2br(cs.intro)}</p>`;

    const hasBullets = cs.bullets && cs.bullets.length;
    const hasItems = cs.items && cs.items.length;

    if(hasBullets || editing){
      html += `<div class="subhead"><h3>Notes</h3>${editing?`<div style="display:flex; gap:12px;">
        <button class="textlink" data-action="edit-section-bullets" data-id="${cs.id}">${hasBullets?"Edit list":"+ Add list"}</button>
        ${hasBullets?`<button class="textlink danger" data-action="remove-section-bullets" data-id="${cs.id}">Remove list</button>`:''}
      </div>`:''}</div>`;
      if(hasBullets){
        html += `<ul class="bullets">` + cs.bullets.map(b=>`<li>${esc(b)}</li>`).join("") + `</ul>`;
      } else if(editing){
        html += `<div class="hint" style="margin:0 0 14px;">No list yet — notes are optional.</div>`;
      }
    }

    if(hasItems || editing){
      html += `<div class="subhead"><h3>Entries</h3>${editing?`<button class="btn sm accent" data-action="add-section-item" data-id="${cs.id}">+ Add entry</button>`:''}</div>`;
      if(hasItems){
        cs.items.forEach((item, itemIdx)=>{
          html += `<div class="entry">
            <div class="entry-top">
              <div>
                <div class="entry-title" style="font-size:1rem;">${esc(item.title)}</div>
                <div class="entry-meta">${esc(item.subtitle)}${item.subtitle && item.date ? " · " : ""}${esc(item.date)}</div>
              </div>
              ${editing?`<div class="entry-actions">
                ${moveButtons("sectionItems", item.id, cs.id, itemIdx, cs.items.length)}
                <button class="textlink" data-action="edit-section-item" data-id="${item.id}" data-section-id="${cs.id}">Edit</button>
                <button class="textlink danger" data-action="delete-section-item" data-id="${item.id}" data-section-id="${cs.id}">Delete</button>
              </div>`:''}
            </div>
            ${item.description?`<div class="entry-desc">${nl2br(item.description)}</div>`:''}
            ${renderCertTrigger(item)}
          </div>`;
        });
      } else if(editing){
        html += `<div class="hint" style="margin:0;">No entries yet — entries are optional too.</div>`;
      }
    }

    if(!cs.intro && !hasBullets && !hasItems && !editing){
      html += `<div class="empty-state">Nothing here yet.</div>`;
    }
    return html;
  }

  /* ============ CONTACT ============ */
  function renderContact(editing){
    const c = Object.assign({email:"",phone:"",location:"",availability:"",preferred:"",resumeUrl:"",blurb:"",links:[]}, data.contact||{});
    let html = `<div class="section-heading"><div><span class="section-eyebrow">Get in touch</span><h2>Contact</h2></div>${editing?'<button class="btn ghost sm" data-action="edit-contact">Edit</button>':''}</div>`;
    if(c.blurb) html += `<p class="blurb">${nl2br(c.blurb)}</p>`;

    const rows = [
      ["Email", c.email], ["Phone", c.phone], ["Location", c.location],
      ["Availability", c.availability], ["Preferred contact", c.preferred]
    ].filter(([,val])=>val);

    html += `<div class="subhead" style="margin-top:${c.blurb?'26px':'0'};"><h3>Contact Details</h3></div>`;
    if(rows.length){
      html += `<dl class="contact-grid">`;
      rows.forEach(([label,val])=>{ html += `<div class="contact-row"><dt>${esc(label)}</dt><dd>${esc(val)}</dd></div>`; });
      html += `</dl>`;
    } else if(!editing){
      html += `<div class="empty-state">Contact details coming soon.</div>`;
    } else {
      html += `<div class="empty-state">No details yet — add your email and any other details with "Edit".</div>`;
    }

    const hasVcard = c.email || c.phone;
    if(c.email || c.resumeUrl || hasVcard){
      html += `<div class="contact-actions">`;
      if(c.email){ html += `<button class="btn ghost" data-action="copy-email" data-value="${esc(c.email)}">Copy email address</button>`; }
      if(hasVcard){ html += `<button class="btn ghost" data-action="download-vcard">Save contact card</button>`; }
      if(c.resumeUrl){ html += `<a class="btn ghost" href="${esc(c.resumeUrl)}" target="_blank" rel="noopener">Download résumé</a>`; }
      html += `</div>`;
    }

    if(data.profile.socials && data.profile.socials.length){
      html += `<div class="socials-row" style="margin-top:14px;">` + data.profile.socials.map(s=>`<a class="social-link" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join("") + `</div>`;
    }

    const hasContactLinks = c.links && c.links.length;
    if(hasContactLinks || editing){
      html += `<div class="subhead"><h3>Additional Links</h3>${editing?`<button class="textlink" data-action="edit-contact-links">Edit links</button>`:''}</div>`;
      if(hasContactLinks){
        html += `<div class="socials-row">` + c.links.map(l=>`<a class="social-link" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join("") + `</div>`;
      } else if(editing){
        html += `<div class="hint" style="margin:0;">No extra links yet — add a scheduling page, WhatsApp, Discord, or anything else you'd like here.</div>`;
      }
    }

    html += `<div class="subhead"><h3>Send a Message</h3></div>`;
    html += `<div class="msg-form">
      <div class="field"><label>Name</label><input id="msg_name" placeholder="Your name"></div>
      <div class="field"><label>Your email</label><input id="msg_email" type="email" placeholder="you@example.com"></div>
      <div class="field"><label>Subject (optional)</label><input id="msg_subject" placeholder="e.g. Project inquiry"></div>
      <div class="field"><label>Message</label><textarea id="msg_body" placeholder="Share a few details about your inquiry" style="min-height:100px;"></textarea></div>
      <button class="btn accent" data-action="send-message">Send message</button>
      <span class="hint" style="margin:8px 0 0; display:block;">Sending opens your default email application with this message ready to go.</span>
    </div>`;
    return html;
  }

  /* ============ Modal helpers ============ */
  function closeModal(){ modalRoot.innerHTML = ""; }

  function openFormModal(cfg){
    let html = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${esc(cfg.title)}</h3>
        ${cfg.sub?`<div class="modal-sub">${esc(cfg.sub)}</div>`:''}
        <form id="dyn-form">`;
    cfg.fields.forEach(f=>{
      html += `<div class="field"><label for="f_${f.name}">${esc(f.label)}${f.required?' *':''}</label>`;
      if(f.type === "textarea"){
        html += `<textarea id="f_${f.name}" name="${f.name}" placeholder="${esc(f.placeholder||'')}">${esc(f.value||'')}</textarea>`;
      } else {
        html += `<input id="f_${f.name}" name="${f.name}" type="${f.type||'text'}" value="${esc(f.value||'')}" placeholder="${esc(f.placeholder||'')}">`;
      }
      html += `</div>`;
    });
    html += `</form>
        <div class="modal-actions">
          ${cfg.onDelete ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="modal-delete">Delete</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="modal-submit">${esc(cfg.submitLabel||'Save')}</button>
        </div>
      </div>
    </div>`;
    modalRoot.innerHTML = html;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    if(cfg.onDelete){ modalRoot.querySelector('[data-action="modal-delete"]').onclick = ()=>{ cfg.onDelete(); closeModal(); }; }
    function doSubmit(){
      const values = {}; let missing = false;
      cfg.fields.forEach(f=>{
        const el = document.getElementById("f_"+f.name);
        values[f.name] = el.value.trim();
        if(f.required && !values[f.name]) missing = true;
      });
      if(missing){ showToast("Please fill in the required fields.", true); return; }
      cfg.onSubmit(values);
      closeModal();
    }
    const formEl = document.getElementById("dyn-form");
    if(formEl){ formEl.addEventListener("submit", (e)=>{ e.preventDefault(); doSubmit(); }); }
    modalRoot.querySelector('[data-action="modal-submit"]').onclick = doSubmit;
  }

  /* ============ Auth modals ============ */
  async function callAuthApi(payload){
    const res = await fetch("/api/auth", {
      method:"POST", credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(()=>({}));
    return {ok: res.ok, ...json};
  }

  function openAuthModal(){
    if(!authState.hasPassword){
      openFormModal({
        title:"Set an edit password",
        sub:"This unlocks edit mode for everyone who knows it — it's checked on the server and hashed before storage, never kept as plain text anywhere.",
        fields:[
          {name:"pw", label:"New password", type:"password", required:true},
          {name:"pw2", label:"Confirm password", type:"password", required:true}
        ],
        submitLabel:"Set password & unlock",
        onSubmit:async(v)=>{
          if(v.pw !== v.pw2){ showToast("Passwords don't match.", true); return; }
          if(v.pw.length < 4){ showToast("Use at least 4 characters.", true); return; }
          const result = await callAuthApi({action:"setup", password:v.pw});
          if(!result.ok){ showToast(result.error || "Couldn't set the password.", true); return; }
          authState = {hasPassword:true, authenticated:true};
          state.editing = true; render();
          showToast("Edit mode unlocked");
        }
      });
    } else {
      openFormModal({
        title:"Enter edit password",
        fields:[{name:"pw", label:"Password", type:"password", required:true}],
        submitLabel:"Unlock",
        onSubmit:async(v)=>{
          const result = await callAuthApi({action:"login", password:v.pw});
          if(!result.ok){ showToast(result.error || "That password isn't right.", true); return; }
          authState = {hasPassword:true, authenticated:true};
          state.editing = true; render();
          showToast("Edit mode unlocked");
        }
      });
    }
  }
  function openChangePasswordModal(){
    openFormModal({
      title:"Change edit password",
      fields:[
        {name:"current", label:"Current password", type:"password", required:true},
        {name:"next", label:"New password", type:"password", required:true},
        {name:"next2", label:"Confirm new password", type:"password", required:true}
      ],
      submitLabel:"Update password",
      onSubmit:async(v)=>{
        if(v.next !== v.next2){ showToast("New passwords don't match.", true); return; }
        if(v.next.length < 4){ showToast("Use at least 4 characters.", true); return; }
        const result = await callAuthApi({action:"change", currentPassword:v.current, newPassword:v.next});
        if(!result.ok){ showToast(result.error || "Couldn't update the password.", true); return; }
        showToast("Password updated");
      }
    });
  }
  async function logout(){
    await callAuthApi({action:"logout"});
    authState.authenticated = false;
    state.editing = false;
    render();
  }

  /* ============ Profile modal ============ */
  function openProfileModal(){
    const p = data.profile;
    openFormModal({
      title:"Edit intro",
      fields:[
        {name:"name", label:"Name", value:p.name, required:true},
        {name:"title", label:"Title / tagline", value:p.title, placeholder:"e.g. Frontend developer & photographer"},
        {name:"description", label:"Short description", type:"textarea", value:p.description}
      ],
      submitLabel:"Save",
      onSubmit:(v)=>{ p.name=v.name; p.title=v.title; p.description=v.description; persistAndRender(); }
    });
  }

  /* ============ Socials editor ============ */
  let tempSocials = null;
  let tempSocialsEditIdx = null;
  function openSocialsModal(){ tempSocials = structuredClone(data.profile.socials || []); tempSocialsEditIdx = null; renderSocialsModal(); }
  function renderSocialsModal(){
    let rows = tempSocials.map((s,i)=>`
      <div class="subrow-list-item" style="${i===tempSocialsEditIdx?'border-color:var(--accent);':''}"><span>${esc(s.label)} <span class="meta">${esc(s.url)}</span></span>
      <span style="display:flex; gap:10px; flex-shrink:0;">
        <button class="textlink" data-idx="${i}" data-action="soc-edit">${i===tempSocialsEditIdx?'Editing…':'Edit'}</button>
        <button class="textlink danger" data-idx="${i}" data-action="soc-remove">Remove</button>
      </span></div>`).join("");
    if(!rows) rows = `<div class="hint" style="margin:0 0 10px;">No links yet — add as many as you like below.</div>`;
    const typeOptions = SOCIAL_TYPES.map(t=>`<option value="${t}">${t}</option>`).join("");
    const editing = tempSocialsEditIdx !== null;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Edit links</h3>
        <div class="modal-sub">Add links to GitHub, LinkedIn, a personal site, a resume, or anywhere else people can find you — add as many as you like.</div>
        ${rows}
        <div class="subrow">
          ${editing?'<div class="hint" style="margin-top:0;">Editing an existing link — update the fields and save, or cancel to leave it unchanged.</div>':''}
          <div class="subrow-grid">
            <div class="field" style="margin-bottom:0;"><label>Type</label><select id="soc_type">${typeOptions}</select></div>
            <div class="field" style="margin-bottom:0;"><label>Label</label><input id="soc_label" placeholder="e.g. GitHub"></div>
          </div>
          <div class="field" style="margin-bottom:8px;"><label>URL</label><input id="soc_url" placeholder="https://..."></div>
          <div style="display:flex; gap:10px;">
            <button class="btn ghost sm" data-action="soc-add" type="button">${editing ? "Save edited link" : "+ Add link"}</button>
            ${editing?'<button class="btn ghost sm" data-action="soc-cancel-edit" type="button">Cancel edit</button>':''}
          </div>
        </div>
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="soc-save">Save all</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="soc-remove"]').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = +btn.dataset.idx;
        tempSocials.splice(idx,1);
        if(tempSocialsEditIdx===idx) tempSocialsEditIdx = null;
        else if(tempSocialsEditIdx!==null && idx<tempSocialsEditIdx) tempSocialsEditIdx--;
        renderSocialsModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="soc-edit"]').forEach(btn=>{
      btn.onclick = ()=>{ tempSocialsEditIdx = +btn.dataset.idx; renderSocialsModal(); };
    });
    const cancelEditBtn = modalRoot.querySelector('[data-action="soc-cancel-edit"]');
    if(cancelEditBtn){ cancelEditBtn.onclick = ()=>{ tempSocialsEditIdx = null; renderSocialsModal(); }; }
    if(editing){
      const s = tempSocials[tempSocialsEditIdx];
      document.getElementById("soc_type").value = s.type || "other";
      document.getElementById("soc_label").value = s.label || "";
      document.getElementById("soc_url").value = s.url || "";
    }
    modalRoot.querySelector('[data-action="soc-add"]').onclick = ()=>{
      const type = document.getElementById("soc_type").value;
      const label = document.getElementById("soc_label").value.trim();
      const url = document.getElementById("soc_url").value.trim();
      if(!label || !url){ showToast("Add a label and a URL.", true); return; }
      if(editing){
        tempSocials[tempSocialsEditIdx] = Object.assign({}, tempSocials[tempSocialsEditIdx], {type, label, url});
        tempSocialsEditIdx = null;
      } else {
        tempSocials.push({id:uid(), type, label, url});
      }
      renderSocialsModal();
    };
    modalRoot.querySelector('[data-action="soc-save"]').onclick = ()=>{ data.profile.socials = tempSocials; persistAndRender(); closeModal(); };
  }

  /* ============ Achievements / Education ============ */
  let tempRecord = null;
  let tempRecordKind = null;
  function openRecordModal(kind, id){
    tempRecordKind = kind;
    const list = kind === "achievement" ? data.achievements : data.education;
    const existing = id ? list.find(x=>x.id===id) : null;
    tempRecord = existing ? structuredClone(existing) : {id:uid(), title:"", org:"", date:"", description:"", certLink:"", certImage:"", certFileLabel:"", certFileUrl:""};
    renderRecordModal(!!existing);
  }
  function renderRecordModal(isEdit){
    const kind = tempRecordKind;
    const r = tempRecord;
    const titleLabel = kind==="achievement" ? "Title" : "Degree / Program";
    const orgLabel = kind==="achievement" ? "Organization" : "School";

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${isEdit ? `Edit ${kind}` : `Add ${kind}`}</h3>
        <div class="field"><label>${titleLabel} *</label><input id="rec_title" value="${esc(r.title)}"></div>
        <div class="field"><label>${orgLabel}</label><input id="rec_org" value="${esc(r.org)}"></div>
        <div class="field"><label>Date</label><input id="rec_date" value="${esc(r.date)}" placeholder="e.g. 2023 or 2020 – 2024"></div>
        <div class="field"><label>Description</label><textarea id="rec_desc">${esc(r.description)}</textarea></div>

        <div class="subhead" style="margin-top:18px;"><h3 style="font-size:.8rem;">Additional Links (optional)</h3></div>
        <div class="hint" style="margin-top:-2px;">Attach any combination of a link, a photo, and/or a file. Visitors can expand this entry to view them — nothing else changes in the normal view.</div>

        <div class="field"><label>Link</label><input id="rec_cert_link" value="${esc(r.certLink||'')}" placeholder="https://..."></div>

        ${r.certImage ? `<div class="subrow-list-item"><span>Photo attached</span><button class="textlink danger" type="button" data-action="rec-remove-photo">Remove photo</button></div>` : ''}
        <div class="field"><label>${r.certImage?'Replace photo':'Upload photo'}</label><input type="file" id="rec_cert_file" accept="image/*"></div>
        <div class="field"><label>Or paste an image URL</label><input id="rec_cert_url" placeholder="https://..."></div>

        ${r.certFileUrl ? `<div class="subrow-list-item"><span>File attached${r.certFileLabel?': '+esc(r.certFileLabel):''}</span><button class="textlink danger" type="button" data-action="rec-remove-file">Remove file</button></div>` : ''}
        <div class="field"><label>File label (optional)</label><input id="rec_cert_file_label" value="${esc(r.certFileLabel||'')}" placeholder="e.g. Document.pdf"></div>
        <div class="field"><label>${r.certFileUrl?'Replace file':'Upload a file'}</label><input type="file" id="rec_cert_file_upload"></div>
        <div class="field"><label>Or paste a file URL</label><input id="rec_cert_file_url" placeholder="Link to a downloadable file"></div>

        <div class="modal-actions">
          ${isEdit ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="rec-delete">Delete</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="rec-save">${isEdit ? "Save changes" : "Add"}</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    const removeBtn = modalRoot.querySelector('[data-action="rec-remove-photo"]');
    if(removeBtn){ removeBtn.onclick = ()=>{ syncRecordFields(); r.certImage=""; renderRecordModal(isEdit); }; }
    const removeFileBtn = modalRoot.querySelector('[data-action="rec-remove-file"]');
    if(removeFileBtn){ removeFileBtn.onclick = ()=>{ syncRecordFields(); r.certFileUrl=""; r.certFileLabel=""; renderRecordModal(isEdit); }; }
    if(isEdit){
      modalRoot.querySelector('[data-action="rec-delete"]').onclick = ()=>{ deleteRecord(kind, r.id); closeModal(); };
    }
    modalRoot.querySelector('[data-action="rec-save"]').onclick = async ()=>{
      syncRecordFields();
      if(!r.title){ showToast("This needs a title.", true); return; }
      const saveBtn = modalRoot.querySelector('[data-action="rec-save"]');
      const photoInput = document.getElementById("rec_cert_file");
      const photoFile = photoInput && photoInput.files && photoInput.files[0];
      const fileInput = document.getElementById("rec_cert_file_upload");
      const attachedFile = fileInput && fileInput.files && fileInput.files[0];
      if(photoFile || attachedFile){ saveBtn.disabled = true; saveBtn.textContent = "Uploading…"; }
      if(photoFile){
        try{ r.certImage = await uploadImageFile(photoFile, 1400, 0.88); }
        catch(err){ showToast(err.message || "Couldn't upload that image.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      if(attachedFile){
        try{
          r.certFileUrl = await uploadRawFile(attachedFile);
          if(!r.certFileLabel) r.certFileLabel = attachedFile.name;
        }catch(err){ showToast(err.message || "Couldn't upload that file.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      const list = kind === "achievement" ? data.achievements : data.education;
      const idx = list.findIndex(x=>x.id===r.id);
      if(idx>-1){ list[idx] = r; } else { list.push(r); }
      persistAndRender(); closeModal();
    };
  }
  function syncRecordFields(){
    const r = tempRecord;
    r.title = document.getElementById("rec_title").value.trim();
    r.org = document.getElementById("rec_org").value.trim();
    r.date = document.getElementById("rec_date").value.trim();
    r.description = document.getElementById("rec_desc").value.trim();
    r.certLink = document.getElementById("rec_cert_link").value.trim();
    const urlEl = document.getElementById("rec_cert_url");
    if(urlEl && urlEl.value.trim()) r.certImage = urlEl.value.trim();
    r.certFileLabel = document.getElementById("rec_cert_file_label").value.trim();
    const fileUrlEl = document.getElementById("rec_cert_file_url");
    if(fileUrlEl && fileUrlEl.value.trim()) r.certFileUrl = fileUrlEl.value.trim();
  }
  function deleteRecord(kind, id){
    const list = kind === "achievement" ? data.achievements : data.education;
    const idx = list.findIndex(x=>x.id===id);
    if(idx>-1) list.splice(idx,1);
    persistAndRender();
  }

  /* ============ Skills ============ */
  function openSkillModal(id){
    const existing = id ? data.skills.find(x=>x.id===id) : null;
    openFormModal({
      title: existing ? "Edit skill category" : "Add skill category",
      sub:"List skills separated by commas.",
      fields:[
        {name:"category", label:"Category name", value:existing?existing.category:"", placeholder:"e.g. Languages", required:true},
        {name:"items", label:"Skills (comma-separated)", type:"textarea", value:existing?(existing.items||[]).join(", "):"", placeholder:"e.g. JavaScript, Python, SQL"}
      ],
      submitLabel: existing ? "Save changes" : "Add",
      onDelete: existing ? ()=>{ const idx=data.skills.findIndex(x=>x.id===id); if(idx>-1) data.skills.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        const items = v.items.split(",").map(s=>s.trim()).filter(Boolean);
        if(existing){ existing.category=v.category; existing.items=items; } else { data.skills.push({id:uid(), category:v.category, items}); }
        persistAndRender();
      }
    });
  }

  /* ============ Experience ============ */
  function openExpSectionModal(id){
    const existing = id ? data.experience.find(x=>x.id===id) : null;
    openFormModal({
      title: existing ? "Rename section" : "Add experience section",
      fields:[{name:"sectionTitle", label:"Section title", value:existing?existing.sectionTitle:"", placeholder:"e.g. Work Experience", required:true}],
      submitLabel: existing ? "Save" : "Add section",
      onDelete: existing ? ()=>{ const idx=data.experience.findIndex(x=>x.id===id); if(idx>-1) data.experience.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        if(existing){ existing.sectionTitle = v.sectionTitle; } else { data.experience.push({id:uid(), sectionTitle:v.sectionTitle, items:[]}); }
        persistAndRender();
      }
    });
  }
  function openExpItemModal(sectionId, itemId){
    const sec = data.experience.find(s=>s.id===sectionId);
    if(!sec) return;
    const existing = itemId ? sec.items.find(i=>i.id===itemId) : null;
    openFormModal({
      title: existing ? "Edit item" : `Add item to "${sec.sectionTitle}"`,
      fields:[
        {name:"title", label:"Title", value:existing?existing.title:"", placeholder:"e.g. Job title or role", required:true},
        {name:"subtitle", label:"Subtitle", value:existing?existing.subtitle:"", placeholder:"e.g. Company or organization"},
        {name:"date", label:"Date", value:existing?existing.date:"", placeholder:"e.g. 2023 – Present"},
        {name:"description", label:"Description", type:"textarea", value:existing?existing.description:""}
      ],
      submitLabel: existing ? "Save changes" : "Add",
      onDelete: existing ? ()=>{ const idx=sec.items.findIndex(i=>i.id===itemId); if(idx>-1) sec.items.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{ if(existing){ Object.assign(existing, v); } else { sec.items.push({id:uid(), ...v}); } persistAndRender(); }
    });
  }

  /* ============ Custom sections ============ */
  function openAddSectionModal(){
    openFormModal({
      title:"Add a new section",
      sub:"Give it a name — you can add an intro, a list, and entries inside it once it's created.",
      fields:[{name:"title", label:"Section title", placeholder:"e.g. Certifications, Hobbies, Publications", required:true}],
      submitLabel:"Create section",
      onSubmit:(v)=>{
        const cs = {id:uid(), title:v.title, intro:"", bullets:[], items:[]};
        data.customSections.push(cs);
        state.section = "custom:"+cs.id;
        persistAndRender();
      }
    });
  }
  function openRenameSectionModal(id){
    const cs = data.customSections.find(c=>c.id===id);
    if(!cs) return;
    openFormModal({
      title:"Rename section",
      fields:[{name:"title", label:"Section title", value:cs.title, required:true}],
      submitLabel:"Save",
      onSubmit:(v)=>{ cs.title=v.title; persistAndRender(); }
    });
  }
  function deleteCustomSection(id){
    const idx = data.customSections.findIndex(c=>c.id===id);
    if(idx>-1) data.customSections.splice(idx,1);
    if(state.section === "custom:"+id) state.section = "home";
    persistAndRender();
  }
  function openSectionIntroModal(id){
    const cs = data.customSections.find(c=>c.id===id);
    if(!cs) return;
    openFormModal({
      title:"Edit intro text",
      fields:[{name:"intro", label:"Intro", type:"textarea", value:cs.intro||""}],
      submitLabel:"Save",
      onSubmit:(v)=>{ cs.intro=v.intro; persistAndRender(); }
    });
  }
  function openSectionBulletsModal(id){
    const cs = data.customSections.find(c=>c.id===id);
    if(!cs) return;
    openFormModal({
      title:"Edit list",
      sub:"One item per line — good for a simple bulleted list.",
      fields:[{name:"bullets", label:"List items", type:"textarea", value:(cs.bullets||[]).join("\n")}],
      submitLabel:"Save",
      onSubmit:(v)=>{ cs.bullets = v.bullets.split("\n").map(s=>s.trim()).filter(Boolean); persistAndRender(); }
    });
  }
  let tempSectionItem = null;
  let tempSectionItemParentId = null;
  function openSectionItemModal(sectionId, itemId){
    const cs = data.customSections.find(c=>c.id===sectionId);
    if(!cs) return;
    tempSectionItemParentId = sectionId;
    const existing = itemId ? cs.items.find(i=>i.id===itemId) : null;
    tempSectionItem = existing ? structuredClone(existing) : {id:uid(), title:"", subtitle:"", date:"", description:"", certLink:"", certImage:"", certFileLabel:"", certFileUrl:""};
    renderSectionItemModal(!!existing);
  }
  function renderSectionItemModal(isEdit){
    const r = tempSectionItem;
    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>${isEdit ? "Edit entry" : "Add entry"}</h3>
        <div class="field"><label>Title *</label><input id="si_title" value="${esc(r.title)}"></div>
        <div class="field"><label>Subtitle</label><input id="si_subtitle" value="${esc(r.subtitle)}"></div>
        <div class="field"><label>Date</label><input id="si_date" value="${esc(r.date)}"></div>
        <div class="field"><label>Description</label><textarea id="si_desc">${esc(r.description)}</textarea></div>

        <div class="subhead" style="margin-top:18px;"><h3 style="font-size:.8rem;">Additional Links (optional)</h3></div>
        <div class="hint" style="margin-top:-2px;">Attach any combination of a link, a photo, and/or a file. Visitors can expand this entry to view them — nothing else changes in the normal view.</div>

        <div class="field"><label>Link</label><input id="si_cert_link" value="${esc(r.certLink||'')}" placeholder="https://..."></div>

        ${r.certImage ? `<div class="subrow-list-item"><span>Photo attached</span><button class="textlink danger" type="button" data-action="si-remove-photo">Remove photo</button></div>` : ''}
        <div class="field"><label>${r.certImage?'Replace photo':'Upload photo'}</label><input type="file" id="si_cert_file" accept="image/*"></div>
        <div class="field"><label>Or paste an image URL</label><input id="si_cert_url" placeholder="https://..."></div>

        ${r.certFileUrl ? `<div class="subrow-list-item"><span>File attached${r.certFileLabel?': '+esc(r.certFileLabel):''}</span><button class="textlink danger" type="button" data-action="si-remove-file">Remove file</button></div>` : ''}
        <div class="field"><label>File label (optional)</label><input id="si_cert_file_label" value="${esc(r.certFileLabel||'')}" placeholder="e.g. Document.pdf"></div>
        <div class="field"><label>${r.certFileUrl?'Replace file':'Upload a file'}</label><input type="file" id="si_cert_file_upload"></div>
        <div class="field"><label>Or paste a file URL</label><input id="si_cert_file_url" placeholder="Link to a downloadable file"></div>

        <div class="modal-actions">
          ${isEdit ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="si-delete">Delete</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="si-save">${isEdit ? "Save changes" : "Add"}</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    const removeBtn = modalRoot.querySelector('[data-action="si-remove-photo"]');
    if(removeBtn){ removeBtn.onclick = ()=>{ syncSectionItemFields(); r.certImage=""; renderSectionItemModal(isEdit); }; }
    const removeFileBtn = modalRoot.querySelector('[data-action="si-remove-file"]');
    if(removeFileBtn){ removeFileBtn.onclick = ()=>{ syncSectionItemFields(); r.certFileUrl=""; r.certFileLabel=""; renderSectionItemModal(isEdit); }; }
    if(isEdit){
      modalRoot.querySelector('[data-action="si-delete"]').onclick = ()=>{
        const cs = data.customSections.find(c=>c.id===tempSectionItemParentId);
        if(cs){ const idx=cs.items.findIndex(i=>i.id===r.id); if(idx>-1) cs.items.splice(idx,1); }
        persistAndRender(); closeModal();
      };
    }
    modalRoot.querySelector('[data-action="si-save"]').onclick = async ()=>{
      syncSectionItemFields();
      if(!r.title){ showToast("This needs a title.", true); return; }
      const saveBtn = modalRoot.querySelector('[data-action="si-save"]');
      const photoInput = document.getElementById("si_cert_file");
      const photoFile = photoInput && photoInput.files && photoInput.files[0];
      const fileInput = document.getElementById("si_cert_file_upload");
      const attachedFile = fileInput && fileInput.files && fileInput.files[0];
      if(photoFile || attachedFile){ saveBtn.disabled = true; saveBtn.textContent = "Uploading…"; }
      if(photoFile){
        try{ r.certImage = await uploadImageFile(photoFile, 1400, 0.88); }
        catch(err){ showToast(err.message || "Couldn't upload that image.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      if(attachedFile){
        try{
          r.certFileUrl = await uploadRawFile(attachedFile);
          if(!r.certFileLabel) r.certFileLabel = attachedFile.name;
        }catch(err){ showToast(err.message || "Couldn't upload that file.", true); saveBtn.disabled=false; saveBtn.textContent = isEdit?"Save changes":"Add"; return; }
      }
      const cs = data.customSections.find(c=>c.id===tempSectionItemParentId);
      if(!cs){ showToast("That section no longer exists.", true); return; }
      const idx = cs.items.findIndex(i=>i.id===r.id);
      if(idx>-1){ cs.items[idx] = r; } else { cs.items.push(r); }
      persistAndRender(); closeModal();
    };
  }
  function syncSectionItemFields(){
    const r = tempSectionItem;
    r.title = document.getElementById("si_title").value.trim();
    r.subtitle = document.getElementById("si_subtitle").value.trim();
    r.date = document.getElementById("si_date").value.trim();
    r.description = document.getElementById("si_desc").value.trim();
    r.certLink = document.getElementById("si_cert_link").value.trim();
    const urlEl = document.getElementById("si_cert_url");
    if(urlEl && urlEl.value.trim()) r.certImage = urlEl.value.trim();
    r.certFileLabel = document.getElementById("si_cert_file_label").value.trim();
    const fileUrlEl = document.getElementById("si_cert_file_url");
    if(fileUrlEl && fileUrlEl.value.trim()) r.certFileUrl = fileUrlEl.value.trim();
  }

  /* ============ Manage sections ============ */
  function openManageSectionsModal(){ renderManageSectionsModal(); }
  function renderManageSectionsModal(){
    ensureSectionOrder();
    const order = data.sectionOrder;
    const rows = order.map((key, idx)=>{
      let label, isCustom = key.startsWith("custom:"), hidden = false;
      if(isCustom){
        const cs = data.customSections.find(c=>c.id===key.slice(7));
        if(!cs) return "";
        label = cs.title;
      } else {
        const fs = FIXED_SECTIONS.find(s=>s.key===key);
        if(!fs) return "";
        label = fs.label;
        hidden = data.hiddenSections.includes(key);
      }
      const isFirst = idx===0, isLast = idx===order.length-1;
      const tag = isCustom ? '<span class="meta">custom</span>' : (hidden ? '<span class="meta">hidden</span>' : '<span class="meta">visible</span>');
      let controls = `<button class="textlink" data-idx="${idx}" data-action="ms-move-up" ${isFirst?'disabled':''} style="${isFirst?'opacity:.3;':''}">↑</button>
        <button class="textlink" data-idx="${idx}" data-action="ms-move-down" ${isLast?'disabled':''} style="${isLast?'opacity:.3;':''}">↓</button>`;
      if(!isCustom && key!=="home"){
        controls += `<button class="textlink" data-key="${key}" data-action="toggle-hide-section">${hidden?"Show":"Hide"}</button>`;
      }
      if(isCustom){
        controls += `<button class="textlink danger" data-id="${key.slice(7)}" data-action="ms-delete-custom">Delete</button>`;
      }
      return `<div class="subrow-list-item"><span>${esc(label)} ${tag}</span>
        <span style="display:flex; gap:10px; flex-shrink:0; align-items:center;">${controls}</span></div>`;
    }).join("");

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Manage sections</h3>
        <div class="modal-sub">Reorder tabs with the arrows, hide built-in sections you don't need, or remove custom ones.</div>
        ${rows}
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn accent" data-action="modal-cancel">Done</button>
        </div>
      </div>
    </div>`;
    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="toggle-hide-section"]').forEach(btn=>{
      btn.onclick = ()=>{
        const key = btn.dataset.key;
        const idx = data.hiddenSections.indexOf(key);
        if(idx>-1){ data.hiddenSections.splice(idx,1); } else { data.hiddenSections.push(key); }
        saveDraft();
        renderManageSectionsModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="ms-delete-custom"]').forEach(btn=>{
      btn.onclick = ()=>{ deleteCustomSection(btn.dataset.id); renderManageSectionsModal(); };
    });
    modalRoot.querySelectorAll('[data-action="ms-move-up"]').forEach(btn=>{
      btn.onclick = ()=>{
        if(btn.disabled) return;
        const idx = +btn.dataset.idx;
        if(idx<=0) return;
        const arr = data.sectionOrder;
        [arr[idx-1], arr[idx]] = [arr[idx], arr[idx-1]];
        saveDraft();
        renderManageSectionsModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="ms-move-down"]').forEach(btn=>{
      btn.onclick = ()=>{
        if(btn.disabled) return;
        const idx = +btn.dataset.idx;
        if(idx>=data.sectionOrder.length-1) return;
        const arr = data.sectionOrder;
        [arr[idx+1], arr[idx]] = [arr[idx], arr[idx+1]];
        saveDraft();
        renderManageSectionsModal();
      };
    });
  }

  /* ============ Contact ============ */
  function openContactModal(){
    const c = Object.assign({email:"",phone:"",location:"",availability:"",preferred:"",resumeUrl:"",blurb:"",links:[]}, data.contact||{});
    openFormModal({
      title:"Edit contact",
      fields:[
        {name:"email", label:"Email address", value:c.email, placeholder:"you@example.com", required:true},
        {name:"phone", label:"Phone (optional)", value:c.phone, placeholder:"+63 900 000 0000"},
        {name:"location", label:"Location (optional)", value:c.location, placeholder:"e.g. Cebu City, Philippines"},
        {name:"availability", label:"Availability (optional)", value:c.availability, placeholder:"e.g. Open to freelance work"},
        {name:"preferred", label:"Preferred contact method (optional)", value:c.preferred, placeholder:"e.g. Email works best"},
        {name:"resumeUrl", label:"Résumé link (optional)", value:c.resumeUrl, placeholder:"Link to a downloadable résumé"},
        {name:"blurb", label:"Short note (optional)", type:"textarea", value:c.blurb}
      ],
      submitLabel:"Save",
      onSubmit:(v)=>{ data.contact = Object.assign({}, data.contact, v); persistAndRender(); }
    });
  }

  /* ============ Contact links editor ============ */
  let tempContactLinks = null;
  let tempContactLinksEditIdx = null;
  function openContactLinksModal(){
    if(!data.contact.links) data.contact.links = [];
    tempContactLinks = structuredClone(data.contact.links);
    tempContactLinksEditIdx = null;
    renderContactLinksModal();
  }
  function renderContactLinksModal(){
    let rows = tempContactLinks.map((l,i)=>`
      <div class="subrow-list-item" style="${i===tempContactLinksEditIdx?'border-color:var(--accent);':''}"><span>${esc(l.label)} <span class="meta">${esc(l.url)}</span></span>
      <span style="display:flex; gap:10px; flex-shrink:0;">
        <button class="textlink" data-idx="${i}" data-action="cl-edit">${i===tempContactLinksEditIdx?'Editing…':'Edit'}</button>
        <button class="textlink danger" data-idx="${i}" data-action="cl-remove">Remove</button>
      </span></div>`).join("");
    if(!rows) rows = `<div class="hint" style="margin:0 0 10px;">No links yet — add as many as you like below.</div>`;
    const editing = tempContactLinksEditIdx !== null;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true">
        <h3>Additional contact links</h3>
        <div class="modal-sub">Add any extra links you'd like visitors to find here — a scheduling page, WhatsApp, Discord, anything you prefer.</div>
        ${rows}
        <div class="subrow">
          ${editing?'<div class="hint" style="margin-top:0;">Editing an existing link — update the fields and save, or cancel to leave it unchanged.</div>':''}
          <div class="field" style="margin-bottom:8px;"><label>Label</label><input id="cl_label" placeholder="e.g. Book a call"></div>
          <div class="field" style="margin-bottom:8px;"><label>URL</label><input id="cl_url" placeholder="https://..."></div>
          <div style="display:flex; gap:10px;">
            <button class="btn ghost sm" data-action="cl-add" type="button">${editing ? "Save edited link" : "+ Add link"}</button>
            ${editing?'<button class="btn ghost sm" data-action="cl-cancel-edit" type="button">Cancel edit</button>':''}
          </div>
        </div>
        <div class="modal-actions"><span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="cl-save">Save all</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="cl-remove"]').forEach(btn=>{
      btn.onclick = ()=>{
        const idx = +btn.dataset.idx;
        tempContactLinks.splice(idx,1);
        if(tempContactLinksEditIdx===idx) tempContactLinksEditIdx = null;
        else if(tempContactLinksEditIdx!==null && idx<tempContactLinksEditIdx) tempContactLinksEditIdx--;
        renderContactLinksModal();
      };
    });
    modalRoot.querySelectorAll('[data-action="cl-edit"]').forEach(btn=>{
      btn.onclick = ()=>{ tempContactLinksEditIdx = +btn.dataset.idx; renderContactLinksModal(); };
    });
    const cancelEditBtn = modalRoot.querySelector('[data-action="cl-cancel-edit"]');
    if(cancelEditBtn){ cancelEditBtn.onclick = ()=>{ tempContactLinksEditIdx = null; renderContactLinksModal(); }; }
    if(editing){
      const l = tempContactLinks[tempContactLinksEditIdx];
      document.getElementById("cl_label").value = l.label || "";
      document.getElementById("cl_url").value = l.url || "";
    }
    modalRoot.querySelector('[data-action="cl-add"]').onclick = ()=>{
      const label = document.getElementById("cl_label").value.trim();
      const url = document.getElementById("cl_url").value.trim();
      if(!label || !url){ showToast("Add a label and a URL.", true); return; }
      if(editing){
        tempContactLinks[tempContactLinksEditIdx] = Object.assign({}, tempContactLinks[tempContactLinksEditIdx], {label, url});
        tempContactLinksEditIdx = null;
      } else {
        tempContactLinks.push({id:uid(), label, url});
      }
      renderContactLinksModal();
    };
    modalRoot.querySelector('[data-action="cl-save"]').onclick = ()=>{ data.contact.links = tempContactLinks; persistAndRender(); closeModal(); };
  }

  /* ============ Project categories ============ */
  function openProjectCategoryModal(id){
    const existing = id ? data.projectCategories.find(c=>c.id===id) : null;
    openFormModal({
      title: existing ? "Rename category" : "Add project category",
      fields:[{name:"title", label:"Category name", value:existing?existing.title:"", placeholder:"e.g. Web Apps, Client Work", required:true}],
      submitLabel: existing ? "Save" : "Add category",
      onDelete: existing ? ()=>{ const idx=data.projectCategories.findIndex(x=>x.id===id); if(idx>-1) data.projectCategories.splice(idx,1); persistAndRender(); } : null,
      onSubmit:(v)=>{
        if(existing){ existing.title = v.title; } else { data.projectCategories.push({id:uid(), title:v.title, projects:[]}); }
        persistAndRender();
      }
    });
  }

  /* ============ Project editor ============ */
  let tempProject = null;
  let tempProjectCategoryId = null;
  function openProjectModal(categoryId, id){
    tempProjectCategoryId = categoryId;
    const cat = data.projectCategories.find(c=>c.id===categoryId);
    const existing = (id && cat) ? cat.projects.find(p=>p.id===id) : null;
    tempProject = existing ? structuredClone(existing) : {id:uid(), header:"", description:"", tags:[], links:[], files:[], images:[]};
    renderProjectModal(!!existing);
  }
  function renderProjectModal(isEdit){
    const p = tempProject;
    const linkRows = (p.links||[]).map((l,i)=>`
      <div class="subrow-list-item"><span>[${esc(l.type)}] ${esc(l.label)} <span class="meta">${esc(l.url)}</span></span>
      <button class="textlink danger" data-idx="${i}" data-action="link-remove">Remove</button></div>`).join("") || `<div class="hint" style="margin:0 0 10px;">No links yet.</div>`;
    const fileRows = (p.files||[]).map((f,i)=>`
      <div class="subrow-list-item"><span>${esc(f.label)} <span class="meta">${esc(f.url)}</span></span>
      <button class="textlink danger" data-idx="${i}" data-action="file-remove">Remove</button></div>`).join("") || `<div class="hint" style="margin:0 0 10px;">No downloadable files yet.</div>`;
    const imageRows = (p.images||[]).map((im,i)=>`
      <div class="subrow-list-item"><span>${esc(im.caption||"(no caption)")} <span class="meta">${esc(im.url).slice(0,40)}${im.url.length>40?'…':''}</span></span>
      <button class="textlink danger" data-idx="${i}" data-action="image-remove">Remove</button></div>`).join("") || `<div class="hint" style="margin:0 0 10px;">No photos yet.</div>`;

    modalRoot.innerHTML = `<div class="modal-overlay" data-action="overlay-close">
      <div class="modal-box" role="dialog" aria-modal="true" style="max-width:600px;">
        <h3>${isEdit ? "Edit project" : "Add project"}</h3>
        <div class="modal-sub">Give it a header, a description, and optionally links, downloadable files, or photos.</div>

        <div class="field"><label>Header *</label><input id="pr_header" value="${esc(p.header)}" placeholder="Project name"></div>
        <div class="field"><label>Description</label><textarea id="pr_desc" placeholder="What it does, why you built it">${esc(p.description)}</textarea></div>
        <div class="field"><label>Tags (comma-separated)</label><input id="pr_tags" value="${esc((p.tags||[]).join(', '))}" placeholder="e.g. React, Node, Figma"></div>

        <div class="subhead" style="margin-top:18px;"><h3 style="font-size:.8rem;">Links (GitHub, live demo, etc.)</h3></div>
        ${linkRows}
        <div class="subrow">
          <div class="subrow-grid">
            <div class="field" style="margin-bottom:0;"><label>Type</label>
              <select id="ln_type"><option value="github">github</option><option value="live">live / demo</option><option value="other">other</option></select>
            </div>
            <div class="field" style="margin-bottom:0;"><label>Label</label><input id="ln_label" placeholder="e.g. View source"></div>
          </div>
          <div class="field" style="margin-bottom:8px;"><label>URL</label><input id="ln_url" placeholder="https://github.com/..."></div>
          <button class="btn ghost sm" type="button" data-action="link-add">+ Add link</button>
        </div>

        <div class="subhead"><h3 style="font-size:.8rem;">Downloadable files</h3></div>
        <div class="hint" style="margin-top:-2px;">Paste a link to the file (Google Drive, Dropbox, GitHub release, etc.).</div>
        ${fileRows}
        <div class="subrow">
          <div class="subrow-grid">
            <div class="field" style="margin-bottom:0;"><label>Label</label><input id="fl_label" placeholder="e.g. Resume.pdf"></div>
            <div class="field" style="margin-bottom:0;"><label>URL</label><input id="fl_url" placeholder="https://..."></div>
          </div>
          <button class="btn ghost sm" type="button" data-action="file-add">+ Add file</button>
        </div>

        <div class="subhead"><h3 style="font-size:.8rem;">Photos</h3></div>
        <div class="hint" style="margin-top:-2px;">Upload from your device (resized and stored with your portfolio), or paste an image URL.</div>
        ${imageRows}
        <div class="subrow">
          <div class="field" style="margin-bottom:8px;"><label>Upload from device</label><input type="file" id="im_file" accept="image/*"></div>
          <div class="field" style="margin-bottom:8px;"><label>Or paste an image URL</label><input id="im_url" placeholder="https://..."></div>
          <div class="field" style="margin-bottom:8px;"><label>Caption (optional)</label><input id="im_caption" placeholder="e.g. Home screen"></div>
          <button class="btn ghost sm" type="button" data-action="image-add">+ Add photo</button>
        </div>

        <div class="modal-actions">
          ${isEdit ? '<button class="btn ghost sm" style="border-color:var(--danger); color:var(--danger);" data-action="project-delete">Delete project</button>' : ''}
          <span class="spacer"></span>
          <button class="btn ghost" data-action="modal-cancel">Cancel</button>
          <button class="btn accent" data-action="project-save">${isEdit ? "Save changes" : "Add project"}</button>
        </div>
      </div>
    </div>`;

    modalRoot.querySelector('[data-action="modal-cancel"]').onclick = closeModal;
    modalRoot.querySelector('[data-action="overlay-close"]').addEventListener("click", (e)=>{ if(e.target===e.currentTarget) closeModal(); });
    modalRoot.querySelectorAll('[data-action="link-remove"]').forEach(b=>b.onclick=()=>{ p.links.splice(+b.dataset.idx,1); syncProjectFields(); renderProjectModal(isEdit); });
    modalRoot.querySelectorAll('[data-action="file-remove"]').forEach(b=>b.onclick=()=>{ p.files.splice(+b.dataset.idx,1); syncProjectFields(); renderProjectModal(isEdit); });
    modalRoot.querySelectorAll('[data-action="image-remove"]').forEach(b=>b.onclick=()=>{ p.images.splice(+b.dataset.idx,1); syncProjectFields(); renderProjectModal(isEdit); });

    modalRoot.querySelector('[data-action="link-add"]').onclick = ()=>{
      syncProjectFields();
      const type = document.getElementById("ln_type").value;
      const label = document.getElementById("ln_label").value.trim();
      const url = document.getElementById("ln_url").value.trim();
      if(!url){ showToast("Add a URL for the link.", true); return; }
      p.links.push({id:uid(), type, label: label || (type==="github"?"GitHub":"Link"), url});
      renderProjectModal(isEdit);
    };
    modalRoot.querySelector('[data-action="file-add"]').onclick = ()=>{
      syncProjectFields();
      const label = document.getElementById("fl_label").value.trim();
      const url = document.getElementById("fl_url").value.trim();
      if(!label || !url){ showToast("Add a label and URL for the file.", true); return; }
      p.files.push({id:uid(), label, url});
      renderProjectModal(isEdit);
    };
    modalRoot.querySelector('[data-action="image-add"]').onclick = async ()=>{
      syncProjectFields();
      const fileInput = document.getElementById("im_file");
      const url = document.getElementById("im_url").value.trim();
      const caption = document.getElementById("im_caption").value.trim();
      const file = fileInput && fileInput.files && fileInput.files[0];
      if(!file && !url){ showToast("Upload a photo or paste an image URL.", true); return; }
      if(file){
        try{
          const dataUrl = await resizeImageFile(file);
          p.images.push({id:uid(), url:dataUrl, caption});
          renderProjectModal(isEdit);
        }catch(err){ showToast("Couldn't read that image — try a different file.", true); }
      } else {
        p.images.push({id:uid(), url, caption});
        renderProjectModal(isEdit);
      }
    };
    if(isEdit){
      modalRoot.querySelector('[data-action="project-delete"]').onclick = ()=>{
        const cat = data.projectCategories.find(c=>c.id===tempProjectCategoryId);
        if(cat){ const idx = cat.projects.findIndex(x=>x.id===p.id); if(idx>-1) cat.projects.splice(idx,1); }
        persistAndRender(); closeModal();
      };
    }
    modalRoot.querySelector('[data-action="project-save"]').onclick = ()=>{
      syncProjectFields();
      if(!p.header){ showToast("Give the project a header.", true); return; }
      const cat = data.projectCategories.find(c=>c.id===tempProjectCategoryId);
      if(!cat){ showToast("That category no longer exists.", true); return; }
      const idx = cat.projects.findIndex(x=>x.id===p.id);
      if(idx>-1){ cat.projects[idx]=p; } else { cat.projects.push(p); }
      persistAndRender(); closeModal();
    };
  }
  function syncProjectFields(){
    const p = tempProject;
    const headerEl = document.getElementById("pr_header");
    const descEl = document.getElementById("pr_desc");
    const tagsEl = document.getElementById("pr_tags");
    if(headerEl) p.header = headerEl.value.trim();
    if(descEl) p.description = descEl.value.trim();
    if(tagsEl) p.tags = tagsEl.value.split(",").map(s=>s.trim()).filter(Boolean);
  }

  /* ============ Global click delegation ============ */
  document.addEventListener("click", (e)=>{
    const toggleBtn = e.target.closest('[data-action="toggle-cert"]');
    if(toggleBtn){ toggleCertBox(toggleBtn.dataset.id); return; }

    const btn = e.target.closest("[data-action]");
    if(!btn) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    const sectionId = btn.dataset.sectionId;

    switch(action){
      case "nav":
        state.section = btn.dataset.section; render();
        window.scrollTo({top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? "auto" : "smooth"});
        break;
      case "move-item": {
        if(btn.disabled) break;
        const listKey = btn.dataset.list;
        const parentId = btn.dataset.parentId;
        const dir = btn.dataset.dir === "up" ? -1 : 1;
        let arr = null;
        if(listKey === "achievements") arr = data.achievements;
        else if(listKey === "education") arr = data.education;
        else if(listKey === "skills") arr = data.skills;
        else if(listKey === "projectCategories") arr = data.projectCategories;
        else if(listKey === "experience") arr = data.experience;
        else if(listKey === "projects"){ const cat = data.projectCategories.find(c=>c.id===parentId); arr = cat ? cat.projects : null; }
        else if(listKey === "expItems"){ const sec = data.experience.find(s=>s.id===parentId); arr = sec ? sec.items : null; }
        else if(listKey === "sectionItems"){ const cs = data.customSections.find(c=>c.id===parentId); arr = cs ? cs.items : null; }
        if(arr) moveInArray(arr, id, dir);
        persistAndRender();
      } break;
      case "set-theme": prefs.theme = btn.dataset.value; applyPrefs(); savePrefs(); render(); break;
      case "set-size": prefs.size = btn.dataset.value; applyPrefs(); savePrefs(); render(); break;
      case "set-project-photo-size": data.projectPhotoSize = btn.dataset.value; persistAndRender(); break;
      case "toggle-edit":
        if(state.editing){ state.editing = false; render(); } else { openAuthModal(); }
        break;
      case "change-password": openChangePasswordModal(); break;
      case "manage-sections": openManageSectionsModal(); break;
      case "logout": logout(); break;

      case "edit-profile": openProfileModal(); break;
      case "edit-socials": openSocialsModal(); break;
      case "remove-photo": data.profile.photo = ""; persistAndRender(); break;

      case "add-achievement": openRecordModal("achievement", null); break;
      case "edit-achievement": openRecordModal("achievement", id); break;
      case "delete-achievement": deleteRecord("achievement", id); break;

      case "add-education": openRecordModal("education", null); break;
      case "edit-education": openRecordModal("education", id); break;
      case "delete-education": deleteRecord("education", id); break;

      case "add-project-category": openProjectCategoryModal(null); break;
      case "edit-project-category": openProjectCategoryModal(id); break;
      case "delete-project-category": { const idx=data.projectCategories.findIndex(x=>x.id===id); if(idx>-1) data.projectCategories.splice(idx,1); persistAndRender(); } break;
      case "add-project": openProjectModal(id, null); break;
      case "edit-project": openProjectModal(sectionId, id); break;
      case "delete-project": { const cat=data.projectCategories.find(c=>c.id===sectionId); if(cat){ const idx=cat.projects.findIndex(x=>x.id===id); if(idx>-1) cat.projects.splice(idx,1);} persistAndRender(); } break;

      case "add-skill": openSkillModal(null); break;
      case "edit-skill": openSkillModal(id); break;
      case "delete-skill": { const idx=data.skills.findIndex(x=>x.id===id); if(idx>-1) data.skills.splice(idx,1); persistAndRender(); } break;

      case "add-exp-section": openExpSectionModal(null); break;
      case "edit-exp-section": openExpSectionModal(id); break;
      case "delete-exp-section": { const idx=data.experience.findIndex(x=>x.id===id); if(idx>-1) data.experience.splice(idx,1); persistAndRender(); } break;
      case "add-exp-item": openExpItemModal(id, null); break;
      case "edit-exp-item": openExpItemModal(sectionId, id); break;
      case "delete-exp-item": { const sec=data.experience.find(s=>s.id===sectionId); if(sec){ const idx=sec.items.findIndex(i=>i.id===id); if(idx>-1) sec.items.splice(idx,1);} persistAndRender(); } break;

      case "add-section": openAddSectionModal(); break;
      case "rename-section": openRenameSectionModal(id); break;
      case "delete-section": deleteCustomSection(id); break;
      case "edit-section-intro": openSectionIntroModal(id); break;
      case "edit-section-bullets": openSectionBulletsModal(id); break;
      case "remove-section-bullets": { const cs=data.customSections.find(c=>c.id===id); if(cs){ cs.bullets=[]; } persistAndRender(); } break;
      case "add-section-item": openSectionItemModal(id, null); break;
      case "edit-section-item": openSectionItemModal(sectionId, id); break;
      case "delete-section-item": { const cs=data.customSections.find(c=>c.id===sectionId); if(cs){ const idx=cs.items.findIndex(i=>i.id===id); if(idx>-1) cs.items.splice(idx,1);} persistAndRender(); } break;

      case "edit-contact": openContactModal(); break;
      case "edit-contact-links": openContactLinksModal(); break;
      case "copy-email": (async()=>{
        const ok = await copyText(btn.dataset.value);
        showToast(ok ? "Email address copied" : "Couldn't copy — please copy it manually.", !ok);
      })(); break;
      case "download-vcard": downloadVCard(); break;

      case "send-message": {
        const name = document.getElementById("msg_name").value.trim();
        const email = document.getElementById("msg_email").value.trim();
        const subject = document.getElementById("msg_subject").value.trim();
        const body = document.getElementById("msg_body").value.trim();
        if(!name || !email || !body){ showToast("Fill in your name, email, and a message.", true); return; }
        const to = (data.contact && data.contact.email) || "";
        if(!to){ showToast("No contact email is set up yet.", true); return; }
        const mailSubject = subject || `Portfolio message from ${name}`;
        const mailBody = `From: ${name} (${email})\n\n${body}`;
        openMailClient(to, mailSubject, mailBody);
        showToast(`Opening your email app to send this to ${to}`);
      } break;
    }
  });

  document.addEventListener("change", async (e)=>{
    if(e.target && e.target.id === "profile_photo_file"){
      const file = e.target.files && e.target.files[0];
      if(!file) return;
      try{
        const url = await uploadImageFile(file, 600, 0.85);
        data.profile.photo = url;
        persistAndRender();
      }catch(err){ showToast(err.message || "Couldn't upload that image.", true); }
    }
  });

  document.addEventListener("keydown", (e)=>{
    if(e.key === "Escape" && modalRoot.innerHTML.trim() !== ""){ closeModal(); }
  });

  /* ============ Boot ============ */
  (async function boot(){
    await loadAll();
    render();
  })();
})();
