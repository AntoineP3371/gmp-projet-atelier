/* Mode démo (?demo=1) : faux client Supabase en mémoire, données fictives.
   Rien n'est lu ni écrit dans la vraie base ; tout est perdu au rechargement.
   Codes : encadrant / gestionnaire = 1234 · admin = admin · super admin = super */
(function(){
  const iso = d => d.toISOString();
  const ago = n => iso(new Date(Date.now() - n*86400000));
  const day = n => { const d = new Date(Date.now() + n*86400000); return d.toISOString().slice(0,10); };

  const DB = {
    mat_matieres: [
      {nom:'Acier S235',       densite:7.85, prix_kg:1.60,  prix_mode:'ttc', actif:true, maj_at:ago(12)},
      {nom:'Acier inoxydable', densite:7.90, prix_kg:4.83,  prix_mode:'ht',  actif:true, maj_at:ago(12)},
      {nom:'Aluminium',        densite:2.70, prix_kg:4.20,  prix_mode:'ttc', actif:true, maj_at:ago(30)},
      {nom:'Laiton',           densite:8.50, prix_kg:9.50,  prix_mode:'ttc', actif:true, maj_at:ago(45)}
    ],
    // Familles + fournisseurs + associations : organigramme de l'atelier (matiere_SAE.pdf).
    mat_fournisseurs: [
      {nom:'Letoile', actif:true, maj_at:ago(60)},
      {nom:'Almet',   actif:true, maj_at:ago(60)},
      {nom:'EMSO',    actif:true, maj_at:ago(60)}
    ],
    mat_familles: [
      {nom:'Tôles',    actif:true, maj_at:ago(60)},
      {nom:'Barres',   actif:true, maj_at:ago(60)},
      {nom:'Profilés', actif:true, maj_at:ago(60)}
    ],
    mat_four_familles: [
      {id:1, fournisseur:'Letoile', matiere:'Acier S235',       famille:'Tôles',    maj_at:ago(60)},
      {id:2, fournisseur:'Letoile', matiere:'Acier S235',       famille:'Barres',   maj_at:ago(60)},
      {id:3, fournisseur:'Letoile', matiere:'Acier S235',       famille:'Profilés', maj_at:ago(60)},
      {id:4, fournisseur:'Almet',   matiere:'Aluminium',        famille:'Tôles',    maj_at:ago(60)},
      {id:5, fournisseur:'Almet',   matiere:'Aluminium',        famille:'Profilés', maj_at:ago(60)},
      {id:6, fournisseur:'EMSO',    matiere:'Aluminium',        famille:'Barres',   maj_at:ago(60)},
      {id:7, fournisseur:'Almet',   matiere:'Acier inoxydable', famille:'Barres',   maj_at:ago(60)},
      {id:8, fournisseur:'Almet',   matiere:'Acier inoxydable', famille:'Profilés', maj_at:ago(60)},
      {id:9, fournisseur:'EMSO',    matiere:'Acier inoxydable', famille:'Tôles',    maj_at:ago(60)}
      // Laiton : volontairement sans association ("Autre → Ça dépend" de l'organigramme).
    ],
    mat_formes: [
      {nom:'Tôle',                 type:'tole',          famille:'Tôles',    actif:true, maj_at:ago(60)},
      {nom:'Ronde',                type:'rond',          famille:'Barres',   actif:true, maj_at:ago(60)},
      {nom:'Carré',                type:'carre',         famille:'Barres',   actif:true, maj_at:ago(60)},
      {nom:'Méplat',               type:'plat',          famille:'Barres',   actif:true, maj_at:ago(60)},
      {nom:'Tubes rond',           type:'tube_rond',     famille:'Profilés', actif:true, maj_at:ago(60)},
      {nom:'Tubes carrés',         type:'tube_carre_eq', famille:'Profilés', actif:true, maj_at:ago(60)},
      {nom:'Tubes rectangulaires', type:'tube_carre',    famille:'Profilés', actif:true, maj_at:ago(60)},
      {nom:'Cornière',             type:'L',             famille:'Profilés', actif:true, maj_at:ago(60)},
      {nom:'Plat',                 type:'plat',          famille:'Profilés', actif:true, maj_at:ago(60)}
    ],
    mat_bruts: [],
    mat_dates: [
      {id:1, date_commande:day(9),  note:'Commande groupée d’octobre', maj_at:ago(3)},
      {id:2, date_commande:day(37), note:'Commande de novembre',       maj_at:ago(3)}
    ],
    mat_budgets: [
      {parcours:'II',   limite:600, maj_at:ago(20)},
      {parcours:'CPD',  limite:500, maj_at:ago(20)},
      {parcours:'SNRV', limite:400, maj_at:ago(20)}
    ],
    mat_parametres: [
      {cle:'trait_scie',    valeur:'3',    maj_at:ago(20)},
      {cle:'tva_taux',      valeur:'20',   maj_at:ago(20)},
      {cle:'tole_longueur', valeur:'2000', maj_at:ago(20)},
      {cle:'tole_largeur',  valeur:'1000', maj_at:ago(20)}
    ],
    mat_demandes: [],
    etudiants: [
      {nom:'DUPONT', prenom:'Jean', projet:'Robot suiveur de ligne', encadrant1:'PIETRI Antoine', encadrant2:'', encadrant3:'', formation:'BUT 2 Init', parcours:'II'},
      {nom:'MARTIN', prenom:'Léa',  projet:'Robot suiveur de ligne', encadrant1:'PIETRI Antoine', encadrant2:'', encadrant3:'', formation:'BUT 2 Init', parcours:'II'},
      {nom:'BERNARD', prenom:'Hugo', projet:'Porte A380',            encadrant1:'DURAND Claire',  encadrant2:'PIETRI Antoine', encadrant3:'', formation:'BUT 3 App', parcours:'CPD'},
      {nom:'PETIT', prenom:'Emma',  projet:'Porte A380',             encadrant1:'DURAND Claire',  encadrant2:'PIETRI Antoine', encadrant3:'', formation:'BUT 3 App', parcours:'CPD'},
      {nom:'ROBERT', prenom:'Tom',  projet:'Banc d’essai vélo',      encadrant1:'DURAND Claire',  encadrant2:'', encadrant3:'', formation:'BUT 2 App', parcours:'SNRV'}
    ],
    operateurs_public: [{name:'LAFON Marc'}, {name:'PIETRI Antoine'}],
    com_gestionnaires: [{nom:'LAFON Marc'}]
  };

  let seq = 100;
  const add = (matiere, forme, dimsList, longs, extra) => {
    dimsList.forEach(dims => longs.forEach(l => DB.mat_bruts.push(Object.assign(
      {id:++seq, matiere, forme, dims, longueur:l, masse_lin:null, chute_min:null, actif:true, maj_at:ago(15)}, extra||{}))));
  };
  ['Acier S235','Aluminium'].forEach(m => {
    add(m,'Ronde', [10,12,16,20,25,30,40,50].map(d=>({d})), [3000]);
    add(m,'Ronde', [{d:30},{d:40}], [100,250]);
    add(m,'Carré', [10,15,20,25,30].map(c=>({c})), [3000]);
    add(m,'Méplat', [{l:30,e:5},{l:40,e:10},{l:50,e:10},{l:60,e:15}], [3000]);
    add(m,'Tubes rond', [{d:30,e:2},{d:40,e:3},{d:50,e:3}], [3000]);
    add(m,'Tubes carrés', [{a:20,e:2},{a:30,e:3}], [3000]);
    add(m,'Cornière', [{a:30,b:30,e:3},{a:40,b:40,e:4}], [3000]);
    add(m,'Tôle', [1,2,3,4].map(e=>({e})), [2000]);
  });
  add('Acier S235','Plat',     [{l:40,e:8},{l:60,e:10}], [3000]);
  add('Acier inoxydable','Tôle', [1,1.5,2,3].map(e=>({e})), [2000]);

  DB.mat_demandes.push({
    id:1, created_at:ago(6), numero:1, projet:'Robot suiveur de ligne', parcours:'II', formation:'BUT 2 Init',
    etudiant_nom:'DUPONT', etudiant_prenom:'Jean', matiere:'Aluminium', famille:'Barres', fournisseur:'EMSO',
    forme:'Ronde', forme_type:'rond',
    dims:{d:30}, dims_libelle:'Ø30', longueur:80, largeur:null, quantite:2, hors_catalogue:false, notes:'Axes de roues', precision_etudiant:'',
    densite:2.7, prix_kg:4.2, masse_lin:1.908, poids_kg:0.305, cout_matiere:1.28,
    brut_desc:'Aluminium · Ronde Ø30 · 3000 mm · fournisseur EMSO', brut_longueur:3000, brut_qte:1, part_brut:0.053, perdu_mm:6, cout_perte:0.05, reste_mm:2834,
    statut:'validee', decision:'commande', date_commande:day(9), encadrant_nom:'PIETRI Antoine', encadrant_at:ago(5),
    encadrant_commentaire:'OK pour les deux axes.', encadrant_commentaire_at:ago(5),
    gest_nom:'', gest_commentaire:'', commandee_at:null, recue_at:null, remise_at:null, statut_at:ago(5),
    historique:[{t:ago(6),statut:'en_attente',par:'DUPONT Jean'},{t:ago(5),statut:'validee',par:'PIETRI Antoine'}]
  },{
    id:2, created_at:ago(2), numero:1, projet:'Porte A380', parcours:'CPD', formation:'BUT 3 App',
    etudiant_nom:'PETIT', etudiant_prenom:'Emma', matiere:'Acier S235', famille:'Barres', fournisseur:'Letoile',
    forme:'Méplat', forme_type:'plat',
    dims:{l:40,e:10}, dims_libelle:'40×10', longueur:200, largeur:null, quantite:1, hors_catalogue:false, notes:'Platine de fixation', precision_etudiant:'',
    densite:7.85, prix_kg:1.6, masse_lin:3.14, poids_kg:0.628, cout_matiere:1.0,
    brut_desc:'Acier S235 · Méplat 40×10 · 3000 mm · fournisseur Letoile', brut_longueur:3000, brut_qte:1, part_brut:0.067, perdu_mm:3, cout_perte:0.02, reste_mm:2797,
    statut:'en_attente', decision:null, date_commande:null, encadrant_nom:'', encadrant_at:null,
    encadrant_commentaire:'', encadrant_commentaire_at:null,
    gest_nom:'', gest_commentaire:'', commandee_at:null, recue_at:null, remise_at:null, statut_at:ago(2),
    historique:[{t:ago(2),statut:'en_attente',par:'PETIT Emma'}]
  },{
    id:3, created_at:ago(1), numero:2, projet:'Porte A380', parcours:'CPD', formation:'BUT 3 App',
    etudiant_nom:'BERNARD', etudiant_prenom:'Hugo', matiere:'Acier inoxydable', famille:'Tôles', fournisseur:'EMSO',
    forme:'Tôle', forme_type:'tole',
    dims:{e:2}, dims_libelle:'Ép. 2 mm', longueur:300, largeur:150, quantite:1, hors_catalogue:false, notes:'Capot de protection', precision_etudiant:'',
    densite:7.9, prix_kg:5.8, masse_lin:null, poids_kg:0.711, cout_matiere:4.12,
    brut_desc:'Acier inoxydable · Tôle 2 mm · 2000×1000 mm · fournisseur EMSO', brut_longueur:2000, brut_qte:1, part_brut:0.225, perdu_mm:null, cout_perte:3.19, reste_mm:null,
    statut:'en_attente', decision:null, date_commande:null, encadrant_nom:'', encadrant_at:null,
    encadrant_commentaire:'', encadrant_commentaire_at:null,
    gest_nom:'', gest_commentaire:'', commandee_at:null, recue_at:null, remise_at:null, statut_at:ago(1),
    historique:[{t:ago(1),statut:'en_attente',par:'BERNARD Hugo'}]
  });

  const PK = {mat_matieres:'nom', mat_formes:'nom', mat_fournisseurs:'nom', mat_familles:'nom', mat_budgets:'parcours', mat_parametres:'cle'};

  function builder(table){
    const st = {op:'select', filters:[], order:null, rows:null, patch:null};
    const b = {
      select(){ return b; },
      order(col, o){ st.order = [col, (o && o.ascending === false) ? -1 : 1]; return b; },
      eq(k, v){ st.filters.push(r => r[k] === v); return b; },
      insert(rows){ st.op = 'insert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b; },
      update(p){ st.op = 'update'; st.patch = p; return b; },
      delete(){ st.op = 'delete'; return b; },
      upsert(rows){ st.op = 'upsert'; st.rows = Array.isArray(rows) ? rows : [rows]; return b; },
      then(res, rej){ return Promise.resolve(run()).then(res, rej); }
    };
    function run(){
      const t = DB[table];
      if(!t) return {data:null, error:{message:'table inconnue (démo) : '+table}};
      const match = r => st.filters.every(f => f(r));
      if(st.op === 'insert'){
        st.rows.forEach(r => { const row = Object.assign({}, r); if(!row.id && !PK[table]) row.id = ++seq; if(!row.created_at && table==='mat_demandes') row.created_at = iso(new Date()); if(!row.maj_at && table!=='mat_demandes') row.maj_at = iso(new Date()); t.push(row); });
        return {data:st.rows, error:null};
      }
      if(st.op === 'update'){ t.filter(match).forEach(r => Object.assign(r, JSON.parse(JSON.stringify(st.patch)))); return {data:null, error:null}; }
      if(st.op === 'delete'){ for(let i=t.length-1;i>=0;i--) if(match(t[i])) t.splice(i,1); return {data:null, error:null}; }
      if(st.op === 'upsert'){
        const pk = PK[table] || 'id';
        st.rows.forEach(r => { const i = t.findIndex(x => x[pk] === r[pk]); if(i >= 0) Object.assign(t[i], r); else t.push(Object.assign({}, r)); });
        return {data:st.rows, error:null};
      }
      let out = t.filter(match).map(r => JSON.parse(JSON.stringify(r)));
      if(st.order){ const [c, dir] = st.order; out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * dir); }
      return {data:out, error:null};
    }
    return b;
  }

  window.makeDemoClient = function(){
    return {
      from: builder,
      functions: {
        invoke: async (name, o) => {
          const b = (o && o.body) || {};
          if(name === 'verify-code') return {data:{ok: String(b.code) === '1234'}, error:null};
          if(name === 'admin-op'){
            if(b.adminCode === 'super') return {data:{ok:true, role:'super'}, error:null};
            if(b.adminCode === 'admin') return {data:{ok:true, role:'admin'}, error:null};
            return {data:{ok:false}, error:null};
          }
          return {data:{ok:true}, error:null};
        }
      },
      channel(){ const c = {on(){ return c; }, subscribe(){ return c; }}; return c; }
    };
  };
})();
