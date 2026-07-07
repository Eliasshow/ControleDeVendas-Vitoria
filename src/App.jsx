import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import './App.css';

const PRODUTOS = {
  meia7: { nome: "MEIA R$ 7", preco: 7.00, custo: 2.50 },
  meia9: { nome: "MEIA R$ 9 (Promoção)", preco: 9.00, custo: 3.33, especial: true },
  calca80: { nome: "CALÇA FIO 80", preco: 25.00, custo: 11.90 },
  calca_trans: { nome: "CALÇA TRANSLÚCIDA", preco: 40.00, custo: 24.90 },
  pantufa_inf: { nome: "PANTUFA INFANTIL", preco: 70.00, custo: 29.90 },
  pantufa_ad: { nome: "PANTUFA ADULTO", preco: 80.00, custo: 29.90 }
};

const formatCurrency = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateBR = (dateString) => {
  if (!dateString) return '-';
  const partes = dateString.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dateString;
};

export default function App() {
  const [dataInicioFiltro, setDataInicioFiltro] = useState('');
  const [dataFimFiltro, setDataFimFiltro] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState(false);
  const [session, setSession] = useState(null);
  const [vendas, setVendas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // Controle do Modal
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Formulário
  const [itemEditando, setItemEditando] = useState(null);
  const [formData, setFormData] = useState({
    cliente: '', dataVenda: new Date().toISOString().split('T')[0],
    prodKey: '', quantidade: 1, status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0],
    dataEntrega: '', observacao: ''
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  useEffect(() => {
    if (session) {
      fetchVendas();
      const subscription = supabase.channel('vendas-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, () => fetchVendas())
        .subscribe();

      const handleFocus = () => fetchVendas();
      window.addEventListener('focus', handleFocus);
      
      const handleVisibilityChange = () => { if (document.visibilityState === 'visible') fetchVendas(); };
      document.addEventListener('visibilitychange', handleVisibilityChange);

      const interval = setInterval(() => fetchVendas(), 10000); 

      return () => {
        supabase.removeChannel(subscription);
        window.removeEventListener('focus', handleFocus);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        clearInterval(interval);
      };
    }
  }, [session]);

  const fetchVendas = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('vendas').select('*').order('data_venda', { ascending: false });
    if (!error) setVendas(data);
    setLoading(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError('E-mail ou senha incorretos.');
  };

  const handleLogout = async () => await supabase.auth.signOut();

  const calculateDerivedValues = () => {
    const p = PRODUTOS[formData.prodKey];
    if (!p) return { preco: 0, custo: 0, total: 0, pago: 0 };
    const qtd = parseInt(formData.quantidade) || 0;
    let total = 0;

    if (formData.prodKey === 'meia9') {
      const pares = Math.floor(qtd / 2);
      const avulsos = qtd % 2;
      total = (pares * 15.00) + (avulsos * 9.00);
    } else {
      total = p.preco * qtd;
    }

    return { preco: p.preco, custo: p.custo, total, pago: formData.status === 'PAGO' ? total : 0 };
  };

  const vals = calculateDerivedValues();

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    let newData = { ...formData, [name]: value };
    if (name === 'status') newData.dataPagamento = value === 'PAGO' ? new Date().toISOString().split('T')[0] : null;
    setFormData(newData);
  };

  const handleSaveVenda = async (e) => {
    e.preventDefault();
    if (!formData.prodKey) return;
    const p = PRODUTOS[formData.prodKey];
    
    const dbData = {
      cliente: formData.cliente, data_venda: formData.dataVenda, prod_key: formData.prodKey,
      produto_nome: p.nome, preco_unitario: p.preco, custo_unitario: p.custo,
      quantidade: formData.quantidade, valor_total: vals.total, valor_pago: vals.pago,
      custo_total: p.custo * formData.quantidade, status: formData.status,
      data_pagamento: formData.dataPagamento || null, data_entrega: formData.dataEntrega || null,
      observacao: formData.observacao
    };

    if (itemEditando) {
      await supabase.from('vendas').update(dbData).eq('id', itemEditando.id);
    } else {
      await supabase.from('vendas').insert([dbData]);
    }
    
    handleClearForm();
    setIsModalOpen(false); // Fecha o modal após salvar
  };

  const handleEdit = (v) => {
    setItemEditando(v);
    setFormData({
      cliente: v.cliente, dataVenda: v.data_venda, prodKey: v.prod_key, quantidade: v.quantidade,
      status: v.status, dataPagamento: v.data_pagamento || '', dataEntrega: v.data_entrega || '', observacao: v.observacao || ''
    });
    setIsModalOpen(true); // Abre o modal ao clicar em editar
  };

  const handleDelete = async (id) => {
    if (window.confirm("Tem certeza que deseja excluir esta venda?")) {
      await supabase.from('vendas').delete().eq('id', id);
    }
  };

  const handleClearForm = () => {
    setFormData({
      cliente: '', dataVenda: new Date().toISOString().split('T')[0], prodKey: '', quantidade: 1, 
      status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0], dataEntrega: '', observacao: ''
    });
    setItemEditando(null);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    handleClearForm();
  };

  // --- LÓGICA DO FILTRO ---
  const vendasFiltradas = vendas.filter(venda => {
    if (!filtroAtivo) return true; 
    if (!dataInicioFiltro || !dataFimFiltro) return true; 
    const dataVendaLimpa = venda.data_venda ? venda.data_venda.substring(0, 10) : '';
    return dataVendaLimpa >= dataInicioFiltro && dataVendaLimpa <= dataFimFiltro;
  });

  // --- CÁLCULOS FINANCEIROS GLOBAIS ---
  let caixa = 0, fiado = 0, encomenda = 0, custoProdutosPagos = 0;
  vendasFiltradas.forEach(v => {
    if (v.status === 'PAGO') {
      caixa += Number(v.valor_pago);
      custoProdutosPagos += Number(v.custo_total);
    } else if (v.status === 'FIADO') fiado += Number(v.valor_total);
    else if (v.status === 'ENCOMENDA') encomenda += Number(v.valor_total);
  });
  
  const lucroReal = caixa - custoProdutosPagos;

  // --- LÓGICA DO PRODUTO CAMPEÃO ---
  let produtoCampeao = "-";
  let qtdCampeao = 0;

  if (vendasFiltradas.length > 0) {
    const ranking = {};
    vendasFiltradas.forEach(v => {
      ranking[v.produto_nome] = (ranking[v.produto_nome] || 0) + Number(v.quantidade);
    });
    for (const [nome, qtd] of Object.entries(ranking)) {
      if (qtd > qtdCampeao) {
        produtoCampeao = nome;
        qtdCampeao = qtd;
      }
    }
  }

  if (!session) {
    return (
      <div className="login-container">
        <form onSubmit={handleLogin} className="login-form">
          <h2>🔐 Acesso ao Sistema</h2>
          {loginError && <p className="error-msg">{loginError}</p>}
          <input type="email" placeholder="E-mail" value={email} onChange={e => setEmail(e.target.value)} required className="form-control" />
          <input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} required className="form-control" />
          <button type="submit" className="btn-primary w-100">Entrar</button>
        </form>
      </div>
    );
  }

  return (
    <div className="container">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#2c3e50', padding: '15px 20px', color: 'white', borderRadius: '12px', marginBottom: '20px', boxShadow: '0 4px 10px rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <img src="/logo.png" alt="Logo" style={{ width: '45px', height: '45px', borderRadius: '10px', background: 'white', padding: '2px', objectFit: 'contain' }} onError={(e) => { e.target.src = '/logo-oficial.png' }} />
          <h1 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 'bold', letterSpacing: '-0.5px' }}>Vendas Vitória</h1>
        </div>
        <button className="btn-danger" style={{ padding: '8px 16px', borderRadius: '8px', border: 'none', fontWeight: 'bold', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }} onClick={handleLogout}>Sair</button>
      </header>
      
      {/* BARRA DE FILTRO */}
      <div style={{ background: '#ffffff', padding: '15px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
        <h4 style={{ margin: '0 0 10px 0', color: '#333' }}>Filtro de Período</h4>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" className="form-control" style={{ width: 'auto' }} value={dataInicioFiltro} onChange={(e) => setDataInicioFiltro(e.target.value)} />
          <span style={{ fontWeight: 'bold' }}>até</span>
          <input type="date" className="form-control" style={{ width: 'auto' }} value={dataFimFiltro} onChange={(e) => setDataFimFiltro(e.target.value)} />
          <button className="btn btn-primary" onClick={() => setFiltroAtivo(true)} disabled={!dataInicioFiltro || !dataFimFiltro}>Filtrar</button>
          {filtroAtivo && (
            <button className="btn btn-secondary" onClick={() => { setFiltroAtivo(false); setDataInicioFiltro(''); setDataFimFiltro(''); }}>Limpar Filtro</button>
          )}
        </div>
      </div>

      {/* --- PAINEL DE INDICADORES --- */}
      <div style={{ marginBottom: '30px' }}>
        <h2 style={{ fontSize: '1.2rem', color: '#2c3e50', marginBottom: '15px', borderBottom: '2px solid #e9ecef', paddingBottom: '8px' }}>Visão Geral Financeira</h2>
        <div className="dashboard" style={{ marginBottom: '25px' }}>
          <div className="card caixa"><span className="title">💵 Recebido (Caixa)</span><span className="value">{formatCurrency(caixa)}</span></div>
          <div className="card fiado"><span className="title">⏳ A Receber</span><span className="value">{formatCurrency(fiado)}</span></div>
          <div className="card custo"><span className="title">📉 Custo (Pagos)</span><span className="value">{formatCurrency(custoProdutosPagos)}</span></div>
          <div className="card lucro"><span className="title">📈 Lucro Real</span><span className="value">{formatCurrency(lucroReal)}</span></div>
        </div>

        <h2 style={{ fontSize: '1.2rem', color: '#2c3e50', marginBottom: '15px', borderBottom: '2px solid #e9ecef', paddingBottom: '8px' }}>Distribuição e Destaques</h2>
        <div className="dashboard">
          <div className="card extra"><span className="title">🙋‍♂️ Meus 90%</span><span className="value">{formatCurrency(lucroReal * 0.9)}</span></div>
          <div className="card extra"><span className="title">🏢 Empresa 10%</span><span className="value">{formatCurrency(lucroReal * 0.1)}</span></div>
          <div className="card encomenda"><span className="title">📦 Encomendas</span><span className="value">{formatCurrency(encomenda)}</span></div>
          <div className="card destaque">
            <span className="title">🏆 Mais Vendido</span>
            <span className="value" style={{ fontSize: '1.3rem' }}>
              {produtoCampeao} <small style={{fontSize: '0.8rem', color: '#6c757d', fontWeight: 'normal'}}>({qtdCampeao} un)</small>
            </span>
          </div>
        </div>
      </div>

      {/* --- HISTÓRICO EM TELA CHEIA --- */}
      <div className="table-section" style={{ width: '100%', marginBottom: '100px' }}>
        <h2 style={{ marginBottom: '15px', color: '#2c3e50' }}>Histórico de Vendas</h2>
        <div className="historico-cards-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px' }}>
          {loading ? <p>Carregando...</p> : (
            vendasFiltradas.map(v => (
              <div key={v.id} className="venda-card" style={{ background: 'white', borderRadius: '10px', padding: '15px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)', borderLeft: `5px solid ${v.status === 'PAGO' ? '#28a745' : v.status === 'FIADO' ? '#dc3545' : '#ffc107'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#2c3e50', fontWeight: 'bold' }}>{v.cliente}</h3>
                  <span className={`badge badge-${v.status.toLowerCase()}`}>{v.status}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: '#666', fontSize: '0.9rem' }}>
                  <span>📅 {formatDateBR(v.data_venda)}</span>
                  <span style={{ fontWeight: '500' }}>{v.produto_nome} (x{v.quantidade})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #eee', paddingTop: '12px' }}>
                  <span style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#1a1a1a' }}>{formatCurrency(v.valor_total)}</span>
                  <div>
                    <button className="btn-sm btn-primary" style={{ marginRight: '8px', padding: '6px 10px', borderRadius: '6px' }} onClick={() => handleEdit(v)}>✏️</button>
                    <button className="btn-sm btn-danger" style={{ padding: '6px 10px', borderRadius: '6px' }} onClick={() => handleDelete(v.id)}>🗑️</button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- BOTÃO FLUTUANTE (FAB) --- */}
      <button className="fab-button" onClick={() => setIsModalOpen(true)}>
        ➕
      </button>

      {/* --- MODAL DE NOVA VENDA --- */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={handleCloseModal}>✖</button>
            <h2 style={{ marginTop: 0, color: '#2c3e50', borderBottom: '2px solid #f0f0f0', paddingBottom: '10px' }}>
              {itemEditando ? 'Editar Venda' : 'Nova Venda'}
            </h2>
            
            <form onSubmit={handleSaveVenda} style={{ marginTop: '20px' }}>
              <div className="form-group">
                <label>Cliente</label>
                <input type="text" name="cliente" className="form-control" value={formData.cliente} onChange={handleFormChange} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Data Venda</label>
                  <input type="date" name="dataVenda" className="form-control" value={formData.dataVenda} onChange={handleFormChange} required />
                </div>
                <div className="form-group">
                  <label>Status</label>
                  <select name="status" className="form-control" value={formData.status} onChange={handleFormChange} required>
                    <option value="PAGO">PAGO</option>
                    <option value="FIADO">FIADO</option>
                    <option value="ENCOMENDA">ENCOMENDA</option>
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Produto</label>
                <select name="prodKey" className="form-control" value={formData.prodKey} onChange={handleFormChange} required>
                  <option value="">Selecione...</option>
                  {Object.entries(PRODUTOS).map(([key, prod]) => <option key={key} value={key}>{prod.nome}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Quantidade</label><input type="number" name="quantidade" className="form-control" min="1" value={formData.quantidade} onChange={handleFormChange} required /></div>
                <div className="form-group"><label>Total (R$)</label><input type="text" className="form-control bg-lucro font-bold" disabled value={formatCurrency(vals.total)} /></div>
              </div>
              <div className="form-group"><label>Obs</label><input type="text" name="observacao" className="form-control" value={formData.observacao} onChange={handleFormChange} /></div>
              
              <div className="form-buttons" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="button" className="btn-secondary" style={{ flex: 1 }} onClick={handleCloseModal}>Cancelar</button>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}