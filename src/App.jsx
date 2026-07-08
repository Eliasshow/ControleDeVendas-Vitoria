import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import './App.css';

// --- FUNÇÕES DE FORMATAÇÃO ---
const formatCurrency = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateBR = (dateString) => {
  if (!dateString) return '-';
  const partes = dateString.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dateString;
};

export default function App() {
  // --- ESTADOS GERAIS DO SISTEMA ---
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vendas, setVendas] = useState([]);
  const [produtos, setProdutos] = useState([]); 
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  
  // --- NAVEGAÇÃO E MENUS ---
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [paginaAtual, setPaginaAtual] = useState('vendas'); 
  
  // --- FILTROS DE VENDA ---
  const [dataInicioFiltro, setDataInicioFiltro] = useState('');
  const [dataFimFiltro, setDataFimFiltro] = useState('');
  const [filtroAtivo, setFiltroAtivo] = useState(false);
  const [filtroFiadoAtrasado, setFiltroFiadoAtrasado] = useState(false);
  
  // --- FORMULÁRIO DE VENDAS (MODAL) ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [formData, setFormData] = useState({
    cliente: '', dataVenda: new Date().toISOString().split('T')[0],
    prodId: '', quantidade: 1, status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0],
    observacao: ''
  });

  // --- FORMULÁRIO DE PRODUTOS (MODAL ESTOQUE) ---
  const [isProdutoModalOpen, setIsProdutoModalOpen] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [formProduto, setFormProduto] = useState({
    nome: '', preco: '', custo: '', estoque_atual: '', estoque_minimo: 5, categoria: '', ativo: true
  });

  // --- AUTENTICAÇÃO E TEMPO REAL ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  useEffect(() => {
    if (session) {
      fetchVendas();
      fetchProdutos(); 

      const subVendas = supabase.channel('vendas-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, () => fetchVendas())
        .subscribe();
        
      const subProdutos = supabase.channel('produtos-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, () => fetchProdutos())
        .subscribe();

      return () => {
        supabase.removeChannel(subVendas);
        supabase.removeChannel(subProdutos);
      };
    }
  }, [session]);

  const fetchVendas = async () => {
    setLoading(true);
    const { data } = await supabase.from('vendas').select('*').order('data_venda', { ascending: false });
    if (data) setVendas(data);
    setLoading(false);
  };

  const fetchProdutos = async () => {
    const { data } = await supabase.from('produtos').select('*').order('nome', { ascending: true });
    if (data) setProdutos(data);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoginError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setLoginError('E-mail ou senha incorretos.');
  };

  const handleLogout = async () => await supabase.auth.signOut();

  // ==========================================
  // LÓGICA DE VENDAS E BAIXA DE ESTOQUE
  // ==========================================
  const vals = (() => {
    const p = produtos.find(prod => prod.id.toString() === formData.prodId.toString());
    if (!p) return { preco: 0, custo: 0, total: 0, pago: 0 };
    const qtd = parseInt(formData.quantidade) || 0;
    const total = Number(p.preco) * qtd;
    return { preco: p.preco, custo: p.custo, total, pago: formData.status === 'PAGO' ? total : 0 };
  })();

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    let newData = { ...formData, [name]: value };
    if (name === 'status') newData.dataPagamento = value === 'PAGO' ? new Date().toISOString().split('T')[0] : null;
    setFormData(newData);
  };

  const handleSaveVenda = async (e) => {
    e.preventDefault();
    if (!formData.prodId) return;
    
    const p = produtos.find(prod => prod.id.toString() === formData.prodId.toString());
    const qtdVendida = parseInt(formData.quantidade);
    
    const dbData = {
      cliente: formData.cliente, data_venda: formData.dataVenda, prod_key: p.id.toString(), 
      produto_nome: p.nome, preco_unitario: p.preco, custo_unitario: p.custo,
      quantidade: qtdVendida, valor_total: vals.total, valor_pago: vals.pago,
      custo_total: Number(p.custo) * qtdVendida, status: formData.status,
      data_pagamento: formData.dataPagamento || null, observacao: formData.observacao
    };

    if (itemEditando) {
      await supabase.from('vendas').update(dbData).eq('id', itemEditando.id);
    } else {
      await supabase.from('vendas').insert([dbData]);
      const novoEstoque = Number(p.estoque_atual) - qtdVendida;
      await supabase.from('produtos').update({ estoque_atual: novoEstoque }).eq('id', p.id);
    }
    
    await fetchVendas();
    await fetchProdutos();
    handleCloseModal();
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setItemEditando(null);
    setFormData({ cliente: '', dataVenda: new Date().toISOString().split('T')[0], prodId: '', quantidade: 1, status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0], observacao: '' });
  };

  const handleDelete = async (id) => {
    if (window.confirm("Tem certeza que deseja excluir esta venda?")) {
      await supabase.from('vendas').delete().eq('id', id);
      fetchVendas();
    }
  };

  const handleCobrarWhatsApp = (venda) => {
    const mensagem = `Olá *${venda.cliente}*, tudo bem?\n\nPassando para lembrar sobre a venda de *${venda.produto_nome}* realizada no dia ${formatDateBR(venda.data_venda)}. \n\nO valor de *${formatCurrency(venda.valor_total)}* já está disponível para acerto via PIX.\n\n_(Caso já tenha realizado o pagamento, por favor, desconsidere esta mensagem!)_`;
    const url = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
    window.open(url, '_blank');
  };

  // ==========================================
  // LÓGICA DE PRODUTOS (ESTOQUE)
  // ==========================================
  const handleProdutoFormChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormProduto(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleSaveProduto = async (e) => {
    e.preventDefault();
    const dbProd = {
      nome: formProduto.nome,
      preco: Number(formProduto.preco.toString().replace(',','.')),
      custo: Number(formProduto.custo.toString().replace(',','.')),
      estoque_atual: Number(formProduto.estoque_atual),
      estoque_minimo: Number(formProduto.estoque_minimo),
      categoria: formProduto.categoria || 'Geral',
      ativo: formProduto.ativo
    };

    if (produtoEditando) {
      await supabase.from('produtos').update(dbProd).eq('id', produtoEditando.id);
    } else {
      await supabase.from('produtos').insert([dbProd]);
    }
    
    await fetchProdutos(); 
    handleCloseProdutoModal();
  };

  const handleEditProduto = (p) => {
    setProdutoEditando(p);
    setFormProduto({
      nome: p.nome, preco: p.preco, custo: p.custo, estoque_atual: p.estoque_atual,
      estoque_minimo: p.estoque_minimo, categoria: p.categoria || '', ativo: p.ativo
    });
    setIsProdutoModalOpen(true);
  };

  const handleToggleAtivo = async (p) => {
    await supabase.from('produtos').update({ ativo: !p.ativo }).eq('id', p.id);
    await fetchProdutos(); 
  };

  const handleDeleteProduto = async (id) => {
    if (window.confirm("Atenção: Tem certeza que deseja excluir DE VEZ este produto?")) {
      await supabase.from('produtos').delete().eq('id', id);
      await fetchProdutos();
    }
  };

  const handleCloseProdutoModal = () => {
    setIsProdutoModalOpen(false);
    setProdutoEditando(null);
    setFormProduto({ nome: '', preco: '', custo: '', estoque_atual: '', estoque_minimo: 5, categoria: '', ativo: true });
  };

  // --- INDICADORES ---
  const trintaDiasAtras = new Date(); trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
  const dataLimite = trintaDiasAtras.toISOString().split('T')[0];
  const fiadosAtrasados = vendas.filter(v => v.status === 'FIADO' && v.data_venda < dataLimite);
  const totalAtrasado = fiadosAtrasados.reduce((sum, v) => sum + Number(v.valor_total), 0);

  const vendasFiltradas = vendas.filter(venda => {
    if (filtroFiadoAtrasado) return venda.status === 'FIADO' && venda.data_venda < dataLimite;
    if (!filtroAtivo) return true; 
    if (!dataInicioFiltro || !dataFimFiltro) return true; 
    return venda.data_venda.substring(0, 10) >= dataInicioFiltro && venda.data_venda.substring(0, 10) <= dataFimFiltro;
  });

  let caixa = 0, fiado = 0, encomenda = 0, custoProdutosPagos = 0;
  vendasFiltradas.forEach(v => {
    if (v.status === 'PAGO') { caixa += Number(v.valor_pago); custoProdutosPagos += Number(v.custo_total); } 
    else if (v.status === 'FIADO') fiado += Number(v.valor_total);
    else if (v.status === 'ENCOMENDA') encomenda += Number(v.valor_total);
  });
  const lucroReal = caixa - custoProdutosPagos;

  let produtoCampeao = "-"; let qtdCampeao = 0;
  if (vendasFiltradas.length > 0) {
    const ranking = {};
    vendasFiltradas.forEach(v => { ranking[v.produto_nome] = (ranking[v.produto_nome] || 0) + Number(v.quantidade); });
    for (const [nome, qtd] of Object.entries(ranking)) { if (qtd > qtdCampeao) { produtoCampeao = nome; qtdCampeao = qtd; } }
  }

  // ==========================================
  // DADOS PARA OS GRÁFICOS DO DASHBOARD (BI)
  // ==========================================
  
  // 1. Agrupar vendas por dia para o gráfico de linha (faturamento)
  const vendasPorDia = vendas.reduce((acc, v) => {
    const dataFormatada = formatDateBR(v.data_venda.substring(0, 10));
    acc[dataFormatada] = (acc[dataFormatada] || 0) + Number(v.valor_total);
    return acc;
  }, {});
  
  const dadosGraficoLinha = Object.entries(vendasPorDia)
    .map(([data, total]) => ({ data, total }))
    .reverse(); // Inverte para ordem cronológica (assumindo que as vendas vêm das mais recentes pras mais antigas)

  // 2. Top 5 Produtos por Faturamento para o gráfico de barras
  const faturamentoPorProduto = vendas.reduce((acc, v) => {
    acc[v.produto_nome] = (acc[v.produto_nome] || 0) + Number(v.valor_total);
    return acc;
  }, {});

  const dadosGraficoBarras = Object.entries(faturamentoPorProduto)
    .map(([nome, faturamento]) => ({ nome, faturamento }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, 5); // Pega só os 5 melhores

  // --- RENDERIZAÇÃO DE LOGIN ---
  if (!session) {
    return (
      <div className="login-container">
        <form onSubmit={handleLogin} className="login-form"><h2>🔐 Acesso ao Sistema</h2>
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
      {/* SIDEBAR (MENU) */}
      {isSidebarOpen && (
        <div className="modal-overlay" onClick={() => setIsSidebarOpen(false)}>
          <div className="modal-content" style={{ position: 'fixed', left: 0, top: 0, height: '100%', maxWidth: '300px', margin: 0, borderRadius: '0 16px 16px 0', animation: 'slideRight 0.3s ease-out' }}>
            <button className="close-modal" onClick={() => setIsSidebarOpen(false)}>✖</button>
            <h2 style={{ color: '#2c3e50', borderBottom: '2px solid #f0f0f0', paddingBottom: '10px' }}>Menu de Gestão</h2>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
              <button className={`btn ${paginaAtual === 'vendas' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setPaginaAtual('vendas'); setIsSidebarOpen(false); }} style={{ textAlign: 'left', padding: '12px' }}>🏠 Início (Vendas)</button>
              <button className={`btn ${paginaAtual === 'estoque' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setPaginaAtual('estoque'); setIsSidebarOpen(false); }} style={{ textAlign: 'left', padding: '12px' }}>📦 Controle de Estoque</button>
              <button className={`btn ${paginaAtual === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setPaginaAtual('dashboard'); setIsSidebarOpen(false); }} style={{ textAlign: 'left', padding: '12px' }}>📊 Dashboard (BI)</button>
              <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid #eee' }}><button className="btn btn-danger" style={{ width: '100%' }} onClick={handleLogout}>Sair do Sistema</button></div>
            </div>
          </div>
        </div>
      )}

      {/* CABEÇALHO */}
      <header style={{ display: 'flex', alignItems: 'center', background: '#2c3e50', padding: '12px 20px', color: 'white', borderRadius: '12px', marginBottom: '20px', gap: '20px' }}>
        <button onClick={() => setIsSidebarOpen(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'white', padding: '5px', display: 'flex' }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg></button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><img src="/logo.png" style={{ width: '38px', borderRadius: '8px', background: 'white' }} /><h1 style={{ margin: 0, fontSize: '1.4rem' }}>Vendas Vitória</h1></div>
      </header>
      
      {/* ======================= PÁGINA 1: VENDAS ======================= */}
      {paginaAtual === 'vendas' && (
        <>
          {fiadosAtrasados.length > 0 && (
            <div style={{ background: '#f8d7da', color: '#721c24', padding: '15px', borderRadius: '8px', marginBottom: '20px', borderLeft: '5px solid #dc3545', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>🚨 Cobrança Pendente!</strong><br/>{fiadosAtrasados.length} vendas em atraso. Total: {formatCurrency(totalAtrasado)}</div>
              {!filtroFiadoAtrasado && <button onClick={() => setFiltroFiadoAtrasado(true)} className="btn btn-danger">🔍 Filtrar</button>}
            </div>
          )}

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
                <span className="value" style={{ fontSize: '1.3rem' }}>{produtoCampeao} <small style={{fontSize: '0.8rem', color: '#6c757d', fontWeight: 'normal'}}>({qtdCampeao} un)</small></span>
              </div>
            </div>
          </div>

          <div className="table-section" style={{ width: '100%', marginBottom: '100px' }}>
            <h2 style={{ marginBottom: '15px', color: '#2c3e50' }}>Histórico de Vendas</h2>
            <div className="historico-cards-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px' }}>
              {vendasFiltradas.map(v => (
                <div key={v.id} className="venda-card" style={{ background: 'white', borderRadius: '10px', padding: '15px', borderLeft: `5px solid ${v.status === 'PAGO' ? '#28a745' : v.status === 'FIADO' ? '#dc3545' : '#ffc107'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>{v.cliente}</h3><span className={`badge badge-${v.status.toLowerCase()}`}>{v.status}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0', color: '#666' }}><span>📅 {formatDateBR(v.data_venda)}</span><span>{v.produto_nome} (x{v.quantidade})</span></div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #eee', paddingTop: '12px' }}>
                    <span style={{ fontSize: '1.3rem', fontWeight: 'bold', color: '#1a1a1a' }}>{formatCurrency(v.valor_total)}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {v.status === 'FIADO' && (
                        <button className="btn-sm" style={{ background: '#25D366', color: 'white', padding: '6px 10px', borderRadius: '6px', border: 'none', cursor: 'pointer' }} onClick={() => handleCobrarWhatsApp(v)}>💬 Cobrar</button>
                      )}
                      <button className="btn-sm btn-danger" style={{ padding: '6px 10px', borderRadius: '6px' }} onClick={() => handleDelete(v.id)}>🗑️</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button className="fab-button" onClick={() => setIsModalOpen(true)}>➕</button>
        </>
      )}

      {/* ======================= PÁGINA 2: ESTOQUE ======================= */}
      {paginaAtual === 'estoque' && (
        <div style={{ marginBottom: '100px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ color: '#2c3e50', margin: 0 }}>📦 Controle de Estoque</h2>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button className="btn btn-primary" onClick={() => setIsProdutoModalOpen(true)}>+ Novo Produto</button>
            </div>
          </div>

          <div className="historico-cards-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
            {produtos.length === 0 ? (
              <p style={{ color: '#666' }}>Nenhum produto cadastrado. Clique no botão acima para adicionar.</p>
            ) : (
              produtos.map(p => {
                const estoqueCritico = p.estoque_atual <= p.estoque_minimo;
                return (
                  <div key={p.id} className="venda-card" style={{ background: 'white', borderRadius: '10px', padding: '15px', opacity: p.ativo ? 1 : 0.6, borderLeft: `5px solid ${p.ativo ? (estoqueCritico ? '#dc3545' : '#17a2b8') : '#6c757d'}` }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <h3 style={{ margin: 0, fontSize: '1.2rem', textDecoration: !p.ativo ? 'line-through' : 'none' }}>{p.nome}</h3>
                      <span className="badge" style={{ background: p.ativo ? '#e9ecef' : '#6c757d', color: p.ativo ? '#333' : 'white' }}>{p.categoria}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', color: '#555' }}>
                      <span>Preço: <strong>{formatCurrency(p.preco)}</strong></span>
                      <span>Custo: {formatCurrency(p.custo)}</span>
                    </div>
                    <div style={{ marginTop: '10px', padding: '8px', borderRadius: '6px', background: estoqueCritico ? '#f8d7da' : '#d4edda', color: estoqueCritico ? '#721c24' : '#155724', fontWeight: 'bold', textAlign: 'center' }}>
                      Estoque Atual: {p.estoque_atual} {estoqueCritico && '⚠️'}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                      <button className="btn-sm btn-secondary" onClick={() => handleToggleAtivo(p)}>{p.ativo ? 'Inativar' : 'Ativar'}</button>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-sm btn-primary" style={{ padding: '6px 10px', borderRadius: '6px' }} onClick={() => handleEditProduto(p)}>✏️</button>
                        <button className="btn-sm btn-danger" style={{ padding: '6px 10px', borderRadius: '6px' }} onClick={() => handleDeleteProduto(p.id)}>🗑️</button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ======================= PÁGINA 3: DASHBOARD (BI) ======================= */}
      {paginaAtual === 'dashboard' && (
        <div style={{ marginBottom: '100px' }}>
          <h2 style={{ color: '#2c3e50', marginBottom: '20px' }}>📊 Inteligência de Negócio</h2>
          
          <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#444' }}>Resumo Geral</h3>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '15px' }}>
              
              <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #007bff' }}>
                <span style={{ fontSize: '0.9rem', color: '#666' }}>Total de Vendas Registradas</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#333' }}>{vendas.length}</div>
              </div>

              <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '8px', borderLeft: '4px solid #17a2b8' }}>
                <span style={{ fontSize: '0.9rem', color: '#666' }}>Ticket Médio (Por Venda)</span>
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#333' }}>
                  {formatCurrency(vendas.reduce((acc, v) => acc + Number(v.valor_total), 0) / (vendas.length || 1))}
                </div>
              </div>

            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
            {/* GRÁFICO 1: EVOLUÇÃO DE VENDAS */}
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '1.1rem' }}>📈 Evolução de Vendas por Dia (R$)</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <LineChart data={dadosGraficoLinha} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="data" tick={{fontSize: 12}} />
                    <YAxis tickFormatter={(val) => `R$ ${val}`} tick={{fontSize: 12}} />
                    <Tooltip formatter={(value) => formatCurrency(value)} labelStyle={{color: '#333'}} />
                    <Line type="monotone" dataKey="total" stroke="#007bff" strokeWidth={3} dot={{r: 4, fill: '#007bff'}} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* GRÁFICO 2: TOP 5 PRODUTOS */}
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '1.1rem' }}>🏆 Top 5 Produtos por Faturamento</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={dadosGraficoBarras} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="nome" tick={{fontSize: 11}} interval={0} angle={-15} textAnchor="end" />
                    <YAxis tickFormatter={(val) => `R$ ${val}`} tick={{fontSize: 12}} />
                    <Tooltip formatter={(value) => formatCurrency(value)} cursor={{fill: '#f8f9fa'}} />
                    <Bar dataKey="faturamento" fill="#28a745" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL DE NOVA VENDA E ESTOQUE CONTINUAM AQUI EMBAIXO ... --- */}
      {/* --- MODAL DE NOVA VENDA --- */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={handleCloseModal}>✖</button>
            <h2 style={{ marginTop: 0 }}>Registrar Venda</h2>
            <form onSubmit={handleSaveVenda} style={{ marginTop: '20px' }}>
              <div className="form-group"><label>Cliente</label><input type="text" name="cliente" className="form-control" value={formData.cliente} onChange={handleFormChange} required /></div>
              <div className="form-row">
                <div className="form-group"><label>Data</label><input type="date" name="dataVenda" className="form-control" value={formData.dataVenda} onChange={handleFormChange} required /></div>
                <div className="form-group"><label>Status</label>
                  <select name="status" className="form-control" value={formData.status} onChange={handleFormChange} required>
                    <option value="PAGO">PAGO</option><option value="FIADO">FIADO</option><option value="ENCOMENDA">ENCOMENDA</option>
                  </select>
                </div>
              </div>
              <div className="form-group"><label>Produto</label>
                <select name="prodId" className="form-control" value={formData.prodId} onChange={handleFormChange} required>
                  <option value="">Selecione...</option>
                  {produtos.filter(p => p.ativo).map(p => <option key={p.id} value={p.id}>{p.nome} (Estoque: {p.estoque_atual})</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Quantidade</label><input type="number" name="quantidade" className="form-control" min="1" value={formData.quantidade} onChange={handleFormChange} required /></div>
                <div className="form-group"><label>Total (R$)</label><input type="text" className="form-control font-bold" disabled value={formatCurrency(vals.total)} /></div>
              </div>
              <div className="form-buttons" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Confirmar Venda</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- MODAL DE PRODUTO (ESTOQUE) --- */}
      {isProdutoModalOpen && (
        <div className="modal-overlay" onClick={handleCloseProdutoModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={handleCloseProdutoModal}>✖</button>
            <h2 style={{ marginTop: 0 }}>{produtoEditando ? 'Editar Produto' : 'Novo Produto'}</h2>
            <form onSubmit={handleSaveProduto} style={{ marginTop: '20px' }}>
              <div className="form-group"><label>Nome do Produto (Ex: Térmica Longa)</label><input type="text" name="nome" className="form-control" value={formProduto.nome} onChange={handleProdutoFormChange} required /></div>
              <div className="form-row">
                <div className="form-group"><label>Preço Venda (R$)</label><input type="number" step="0.01" name="preco" className="form-control" value={formProduto.preco} onChange={handleProdutoFormChange} required /></div>
                <div className="form-group"><label>Custo (R$)</label><input type="number" step="0.01" name="custo" className="form-control" value={formProduto.custo} onChange={handleProdutoFormChange} required /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Qtd em Estoque</label><input type="number" name="estoque_atual" className="form-control" value={formProduto.estoque_atual} onChange={handleProdutoFormChange} required /></div>
                <div className="form-group"><label>Alerta Mínimo</label><input type="number" name="estoque_minimo" className="form-control" value={formProduto.estoque_minimo} onChange={handleProdutoFormChange} required /></div>
              </div>
              <div className="form-group"><label>Categoria</label>
                <select name="categoria" className="form-control" value={formProduto.categoria} onChange={handleProdutoFormChange}>
                  <option value="">Selecione...</option><option value="Meias">Meias</option><option value="Calças">Calças</option><option value="Térmicas">Térmicas</option><option value="Pantufas">Pantufas</option><option value="Kits">Kits</option>
                </select>
              </div>
              <div className="form-buttons" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                <button type="submit" className="btn-primary" style={{ flex: 1 }}>Salvar Produto</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}