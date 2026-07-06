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
  const [session, setSession] = useState(null);
  const [vendas, setVendas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // Formulário
  const [itemEditando, setItemEditando] = useState(null);
  const [formData, setFormData] = useState({
    cliente: '', dataVenda: new Date().toISOString().split('T')[0],
    prodKey: '', quantidade: 1, status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0],
    dataEntrega: '', observacao: ''
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
  }, []);

  useEffect(() => {
    if (session) {
      fetchVendas();
      // Sincronização em Tempo Real (Realtime)
      const subscription = supabase
        .channel('vendas-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, (payload) => {
          fetchVendas();
        })
        .subscribe();

      return () => supabase.removeChannel(subscription);
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

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Regras de Negócio e Cálculos
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

    return {
      preco: p.preco, custo: p.custo, total,
      pago: formData.status === 'PAGO' ? total : 0
    };
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
      cliente: formData.cliente,
      data_venda: formData.dataVenda,
      prod_key: formData.prodKey,
      produto_nome: p.nome,
      preco_unitario: p.preco,
      custo_unitario: p.custo,
      quantidade: formData.quantidade,
      valor_total: vals.total,
      valor_pago: vals.pago,
      custo_total: p.custo * formData.quantidade,
      status: formData.status,
      data_pagamento: formData.dataPagamento || null,
      data_entrega: formData.dataEntrega || null,
      observacao: formData.observacao
    };

    if (itemEditando) {
      await supabase.from('vendas').update(dbData).eq('id', itemEditando.id);
    } else {
      await supabase.from('vendas').insert([dbData]);
    }
    
    handleClearForm();
  };

  const handleEdit = (v) => {
    setItemEditando(v);
    setFormData({
      cliente: v.cliente, dataVenda: v.data_venda, prodKey: v.prod_key, quantidade: v.quantidade,
      status: v.status, dataPagamento: v.data_pagamento || '', dataEntrega: v.data_entrega || '', observacao: v.observacao || ''
    });
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

  // Cálculos Financeiros Globais
  let caixa = 0, fiado = 0, encomenda = 0, custoProdutosPagos = 0;
  vendas.forEach(v => {
    if (v.status === 'PAGO') {
      caixa += Number(v.valor_pago);
      custoProdutosPagos += Number(v.custo_total);
    } else if (v.status === 'FIADO') fiado += Number(v.valor_total);
    else if (v.status === 'ENCOMENDA') encomenda += Number(v.valor_total);
  });
  
  const lucroReal = caixa - custoProdutosPagos;

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
      <header>
        <h1>📊 Vendas em Tempo Real</h1>
        <button className="btn-danger" onClick={handleLogout}>Sair</button>
      </header>

      <div className="dashboard">
        <div className="card caixa"><span className="title">💵 Caixa / Recebido</span><span className="value">{formatCurrency(caixa)}</span></div>
        <div className="card fiado"><span className="title">⏳ A Receber</span><span className="value">{formatCurrency(fiado)}</span></div>
        <div className="card encomenda"><span className="title">📦 Encomendas</span><span className="value">{formatCurrency(encomenda)}</span></div>
        <div className="card"><span className="title">📉 Custo (Pagos)</span><span className="value">{formatCurrency(custoProdutosPagos)}</span></div>
        <div className="card lucro"><span className="title">📈 Lucro Real</span><span className="value">{formatCurrency(lucroReal)}</span></div>
        <div className="card extra"><span className="title">🙋‍♂️ Meus 90%</span><span className="value">{formatCurrency(lucroReal * 0.9)}</span></div>
        <div className="card extra"><span className="title">🏢 Empresa 10%</span><span className="value">{formatCurrency(lucroReal * 0.1)}</span></div>
      </div>

      <div className="main-layout">
        <div className="form-section">
          <h2>{itemEditando ? 'Editar Venda' : 'Nova Venda'}</h2>
          <form onSubmit={handleSaveVenda}>
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
            <div className="form-buttons">
              <button type="button" className="btn-secondary" onClick={handleClearForm}>Limpar</button>
              <button type="submit" className="btn-primary">Salvar Venda</button>
            </div>
          </form>
        </div>

        <div className="table-section">
          <h2>Histórico (Tempo Real)</h2>
          <div className="table-wrapper">
            {loading ? <p>Carregando...</p> : (
              <table>
                <thead><tr><th>Cliente</th><th>Data</th><th>Produto</th><th>Qtd</th><th>Total</th><th>Status</th><th>Ações</th></tr></thead>
                <tbody>
                  {vendas.map(v => (
                    <tr key={v.id}>
                      <td className="font-bold">{v.cliente}</td><td>{formatDateBR(v.data_venda)}</td><td>{v.produto_nome}</td><td>{v.quantidade}</td>
                      <td className="font-bold">{formatCurrency(v.valor_total)}</td>
                      <td><span className={`badge badge-${v.status.toLowerCase()}`}>{v.status}</span></td>
                      <td className="actions-cell">
                        <button className="btn-sm btn-primary" onClick={() => handleEdit(v)}>✏️</button>
                        <button className="btn-sm btn-danger" onClick={() => handleDelete(v.id)}>🗑️</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}