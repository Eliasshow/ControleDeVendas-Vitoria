import React, { useState, useEffect } from 'react';
import { supabase } from './supabaseClient';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { jsPDF } from 'jspdf';
import './App.css';

// --- FUNÇÕES DE FORMATAÇÃO ---
const formatCurrency = (value) => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDateBR = (dateString) => {
  if (!dateString) return '-';
  const partes = dateString.split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : dateString;
};

// --- TRADUTOR DE IMAGEM PARA O PDF ---
const carregarImagemBase64 = async (url) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error("Não foi possível carregar a logo.", error);
    return null;
  }
};

export default function App() {
  // --- ESTADOS GERAIS DO SISTEMA ---
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [vendas, setVendas] = useState([]);
  const [produtos, setProdutos] = useState([]); 
  const [clientes, setClientes] = useState([]); 
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
  
  // --- FILTROS DO BI (RAIO-X DE CLIENTE) ---
  const [biClienteNome, setBiClienteNome] = useState('');
  const [biDataInicio, setBiDataInicio] = useState('');
  const [biDataFim, setBiDataFim] = useState('');

  // --- FORMULÁRIOS (MODAIS) ---
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [formData, setFormData] = useState({
    cliente: '', dataVenda: new Date().toISOString().split('T')[0],
    prodId: '', quantidade: 1, status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0], observacao: '',
    valorCobrado: '' 
  });

  const [isProdutoModalOpen, setIsProdutoModalOpen] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState(null);
  const [formProduto, setFormProduto] = useState({
    nome: '', preco: '', custo: '', estoque_atual: '', estoque_minimo: 5, categoria: '', ativo: true
  });

  const [isClienteModalOpen, setIsClienteModalOpen] = useState(false);
  const [clienteEditando, setClienteEditando] = useState(null);
  const [formCliente, setFormCliente] = useState({ nome: '', telefone: '' });

  // --- AUTENTICAÇÃO E TEMPO REAL ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    supabase.auth.onAuthStateChange((_event, session) => setSession(session));
  }, []);

  useEffect(() => {
    if (session) {
      fetchVendas();
      fetchProdutos(); 
      fetchClientes();

      const subVendas = supabase.channel('vendas-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'vendas' }, () => fetchVendas()).subscribe();
      const subProdutos = supabase.channel('produtos-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'produtos' }, () => fetchProdutos()).subscribe();
      const subClientes = supabase.channel('clientes-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, () => fetchClientes()).subscribe();

      return () => { supabase.removeChannel(subVendas); supabase.removeChannel(subProdutos); supabase.removeChannel(subClientes); };
    }
  }, [session]);

  const fetchVendas = async () => { const { data } = await supabase.from('vendas').select('*').order('data_venda', { ascending: false }); if (data) setVendas(data); };
  const fetchProdutos = async () => { const { data } = await supabase.from('produtos').select('*').order('nome', { ascending: true }); if (data) setProdutos(data); };
  const fetchClientes = async () => { const { data } = await supabase.from('clientes').select('*').order('nome', { ascending: true }); if (data) setClientes(data); };

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
  const getSugestaoValor = () => {
    const p = produtos.find(prod => prod.id.toString() === formData.prodId.toString());
    const qtd = parseInt(formData.quantidade) || 0;
    return p ? (Number(p.preco) * qtd) : 0;
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    let newData = { ...formData, [name]: value };
    if (name === 'status') newData.dataPagamento = value === 'PAGO' ? new Date().toISOString().split('T')[0] : null;
    
    if (name === 'prodId' || name === 'quantidade') {
      const p = produtos.find(prod => prod.id.toString() === (name === 'prodId' ? value : formData.prodId).toString());
      const qtd = parseInt(name === 'quantidade' ? value : formData.quantidade) || 0;
      if (p) { newData.valorCobrado = (Number(p.preco) * qtd).toFixed(2); } else { newData.valorCobrado = ''; }
    }
    setFormData(newData);
  };

  const handleSaveVenda = async (e) => {
    e.preventDefault();
    if (!formData.prodId) return;
    
    const clienteDigitado = formData.cliente.trim();
    const clienteJaExiste = clientes.find(c => c.nome.toLowerCase() === clienteDigitado.toLowerCase());

    if (!clienteJaExiste && clienteDigitado) {
      await supabase.from('clientes').insert([{ nome: clienteDigitado, telefone: '' }]);
      await fetchClientes(); 
    }

    const p = produtos.find(prod => prod.id.toString() === formData.prodId.toString());
    const qtdVendida = parseInt(formData.quantidade);
    const valorFinal = Number(formData.valorCobrado);
    
    const dbData = {
      cliente: clienteDigitado, data_venda: formData.dataVenda, prod_key: p.id.toString(), 
      produto_nome: p.nome, preco_unitario: p.preco, custo_unitario: p.custo,
      quantidade: qtdVendida, valor_total: valorFinal, valor_pago: formData.status === 'PAGO' ? valorFinal : 0,
      custo_total: Number(p.custo) * qtdVendida, status: formData.status, data_pagamento: formData.dataPagamento || null, observacao: formData.observacao
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

  const handleEdit = (v) => {
    setItemEditando(v);
    setFormData({
      cliente: v.cliente,
      dataVenda: v.data_venda ? v.data_venda.substring(0, 10) : new Date().toISOString().split('T')[0],
      prodId: v.prod_key,
      quantidade: v.quantidade,
      status: v.status,
      dataPagamento: v.data_pagamento ? v.data_pagamento.substring(0, 10) : new Date().toISOString().split('T')[0],
      observacao: v.observacao || '',
      valorCobrado: v.valor_total
    });
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false); setItemEditando(null);
    setFormData({ cliente: '', dataVenda: new Date().toISOString().split('T')[0], prodId: '', quantidade: 1, status: 'PAGO', dataPagamento: new Date().toISOString().split('T')[0], observacao: '', valorCobrado: '' });
  };

  const handleDelete = async (id) => {
    if (window.confirm("Tem certeza que deseja excluir esta venda?")) { await supabase.from('vendas').delete().eq('id', id); fetchVendas(); }
  };

  const handleCobrarWhatsApp = (venda) => {
    const clienteRecord = clientes.find(c => c.nome.toLowerCase() === venda.cliente.toLowerCase());
    let url = '';
    const message = `Olá *${venda.cliente}*, tudo bem?\n\nPassando para lembrar sobre a venda de *${venda.produto_nome}* realizada no dia ${formatDateBR(venda.data_venda)}. \n\nO valor de *${formatCurrency(venda.valor_total)}* já está disponível para acerto via PIX.\n\n_(Caso já tenha realizado o pagamento, por favor, desconsidere esta mensagem!)_`;

    if (clienteRecord && clienteRecord.telefone) {
      const numeroLimpo = clienteRecord.telefone.replace(/\D/g, '');
      url = `https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(message)}`;
    } else {
      url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    }
    window.open(url, '_blank');
  };

  // ==========================================
  // RECIBO PDF PROFISSIONAL (COM LOGO)
  // ==========================================
  const handleGerarRecibo = async (venda) => {
    try {
      const doc = new jsPDF();
      
      // Busca a imagem convertida
      const logoBase64 = await carregarImagemBase64('/logo.png');

      // CABEÇALHO COM OU SEM LOGO
      if (logoBase64) {
        doc.addImage(logoBase64, 'PNG', 20, 15, 18, 18);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(24);
        doc.setTextColor(44, 62, 80);
        doc.text("Vendas Vitória", 45, 27);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(26);
        doc.setTextColor(44, 62, 80);
        doc.text("Vendas Vitória", 105, 25, null, null, "center");
      }

      doc.setFont("helvetica", "normal");
      doc.setFontSize(12);
      doc.setTextColor(150, 150, 150);
      doc.text("Recibo Digital de Compra", logoBase64 ? 45 : 105, logoBase64 ? 33 : 33, null, null, logoBase64 ? "left" : "center");

      // LINHA SEPARADORA
      doc.setDrawColor(220, 220, 220);
      doc.line(20, 42, 190, 42);

      // DADOS DO CLIENTE
      doc.setTextColor(60, 60, 60);
      doc.setFontSize(10);
      doc.text("DADOS DO CLIENTE", 20, 55);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(venda.cliente, 20, 62);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text("DATA DA COMPRA", 130, 55);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.text(formatDateBR(venda.data_venda), 130, 62);

      // CAIXA DE ITENS (ESTILO TABELA)
      doc.setDrawColor(230, 230, 230);
      doc.setFillColor(252, 252, 252);
      doc.roundedRect(20, 75, 170, 35, 3, 3, 'FD'); // Retângulo com fundo claro

      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text("DESCRIÇÃO DO PRODUTO / SERVIÇO", 25, 83);
      doc.text("QTD", 140, 83);
      doc.text("STATUS", 165, 83);
      
      doc.line(20, 87, 190, 87); // Linha interna

      doc.setFont("helvetica", "bold");
      doc.setFontSize(12);
      doc.setTextColor(50, 50, 50);
      doc.text(venda.produto_nome, 25, 98);
      doc.text(`${venda.quantidade}x`, 140, 98);
      
      // Cor condicional para o Status no PDF
      if (venda.status === 'PAGO') doc.setTextColor(40, 167, 69);
      else if (venda.status === 'FIADO') doc.setTextColor(220, 53, 69);
      else doc.setTextColor(255, 193, 7);
      doc.text(venda.status, 165, 98);

      // OBSERVAÇÃO
      let yCaixaTotal = 120;
      if (venda.observacao) {
        doc.setTextColor(80, 80, 80);
        doc.setFontSize(10);
        doc.setFont("helvetica", "italic");
        doc.text(`Observações: ${venda.observacao}`, 25, 107);
      }

      // CAIXA DO VALOR TOTAL
      doc.setFillColor(240, 248, 255);
      doc.roundedRect(20, yCaixaTotal, 170, 25, 3, 3, 'F');
      doc.setFontSize(14);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(0, 0, 0);
      doc.text(`VALOR TOTAL`, 25, yCaixaTotal + 16);
      
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.text(`${formatCurrency(venda.valor_total)}`, 185, yCaixaTotal + 17, null, null, "right");

      // RODAPÉ COM CARIMBO DE TEMPO
      const dataHoraEmissao = new Date().toLocaleString('pt-BR');
      doc.setFontSize(9);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(150, 150, 150);
      doc.text(`Documento gerado eletronicamente em: ${dataHoraEmissao}`, 105, 275, null, null, "center");
      doc.text("Vendas Vitória - Gestão & Qualidade", 105, 280, null, null, "center");

      // Salva o PDF
      const nomeArquivo = `Recibo_${venda.cliente.replace(/\s+/g, '_')}_${venda.data_venda}.pdf`;
      doc.save(nomeArquivo);
      
    } catch (err) {
      console.error("Erro interno ao gerar o PDF:", err);
      alert("Ocorreu um erro ao gerar o PDF. Verifique o console.");
    }
  };

  // ==========================================
  // LÓGICA DA RÉGUA DE FIDELIDADE
  // ==========================================
  const obterAlertasFidelidade = () => {
    const hoje = new Date();
    const alertas = [];

    clientes.forEach(c => {
      const vendasDoCliente = vendas.filter(v => v.cliente.toLowerCase() === c.nome.toLowerCase());
      if (vendasDoCliente.length === 0) return;

      const datas = vendasDoCliente.map(v => new Date(v.data_venda + 'T00:00:00'));
      const ultimaData = new Date(Math.max(...datas));
      const diffTempo = hoje - ultimaData;
      const diffDias = Math.floor(diffTempo / (1000 * 60 * 60 * 24));

      if (diffDias >= 45) {
        const contagemProdutos = {};
        vendasDoCliente.forEach(v => {
          contagemProdutos[v.produto_nome] = (contagemProdutos[v.produto_nome] || 0) + Number(v.quantidade);
        });

        let produtoFavorito = '';
        let maxQtd = 0;
        for (const [nome, qtd] of Object.entries(contagemProdutos)) {
          if (qtd > maxQtd) { maxQtd = qtd; produtoFavorito = nome; }
        }

        alertas.push({ id: c.id, nome: c.nome, telefone: c.telefone, diasSumido: diffDias, produtoFavorito, totalComprado: maxQtd });
      }
    });
    return alertas;
  };

  const handleSugestaoFidelidadeWhats = (alerta) => {
    const mensagem = `Olá *${alerta.nome}*, tudo bem? Saudades!\n\nPassando para saber como você está. Vi aqui no sistema que faz ${alerta.diasSumido} dias desde a sua última compra com a gente.\n\nLembrei que você gosta muito de *${alerta.produtoFavorito}* (já levou ${alerta.totalComprado} unidades no total!). Como chegaram novidades e reposições no estoque, pensei em te avisar em primeira mão para dar uma olhada e renovar o armário! \n\nSe quiser conferir, me avisa! 😉`;
    let url = '';
    if (alerta.telefone) {
      const numeroLimpo = alerta.telefone.replace(/\D/g, '');
      url = `https://wa.me/55${numeroLimpo}?text=${encodeURIComponent(mensagem)}`;
    } else {
      url = `https://wa.me/?text=${encodeURIComponent(mensagem)}`;
    }
    window.open(url, '_blank');
  };

  // ==========================================
  // LÓGICA DE PRODUTOS E CLIENTES
  // ==========================================
  const handleProdutoFormChange = (e) => { const { name, value, type, checked } = e.target; setFormProduto(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value })); };
  const handleSaveProduto = async (e) => {
    e.preventDefault();
    const dbProd = { nome: formProduto.nome, preco: Number(formProduto.preco.toString().replace(',','.')), custo: Number(formProduto.custo.toString().replace(',','.')), estoque_atual: Number(formProduto.estoque_atual), estoque_minimo: Number(formProduto.estoque_minimo), categoria: formProduto.categoria || 'Geral', ativo: formProduto.ativo };
    if (produtoEditando) { await supabase.from('produtos').update(dbProd).eq('id', produtoEditando.id); } else { await supabase.from('produtos').insert([dbProd]); }
    await fetchProdutos(); handleCloseProdutoModal();
  };
  const handleEditProduto = (p) => { setProdutoEditando(p); setFormProduto({ nome: p.nome, preco: p.preco, custo: p.custo, estoque_atual: p.estoque_atual, estoque_minimo: p.estoque_minimo, category: p.categoria || '', ativo: p.ativo }); setIsProdutoModalOpen(true); };
  const handleToggleAtivo = async (p) => { await supabase.from('produtos').update({ ativo: !p.ativo }).eq('id', p.id); await fetchProdutos(); };
  const handleDeleteProduto = async (id) => { if (window.confirm("Atenção: Tem certeza que deseja excluir DE VEZ este produto?")) { await supabase.from('produtos').delete().eq('id', id); await fetchProdutos(); } };
  const handleCloseProdutoModal = () => { setIsProdutoModalOpen(false); setProdutoEditando(null); setFormProduto({ nome: '', preco: '', custo: '', estoque_atual: '', estoque_minimo: 5, categoria: '', ativo: true }); };

  const handleClienteFormChange = (e) => { setFormCliente({ ...formCliente, [e.target.name]: e.target.value }); };
  const handleSaveCliente = async (e) => {
    e.preventDefault();
    if (clienteEditando) { await supabase.from('clientes').update(formCliente).eq('id', clienteEditando.id); } 
    else { await supabase.from('clientes').insert([formCliente]); }
    await fetchClientes(); handleCloseClienteModal();
  };
  const handleEditCliente = (c) => { setClienteEditando(c); setFormCliente({ nome: c.nome, telefone: c.telefone || '' }); setIsClienteModalOpen(true); };
  const handleCloseClienteModal = () => { setIsClienteModalOpen(false); setClienteEditando(null); setFormCliente({ nome: '', telefone: '' }); };

  // ==========================================
  // INDICADORES GERAIS
  // ==========================================
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

  let faturamentoRecebido = 0, faturamentoFiado = 0, faturamentoEncomenda = 0, custoProdutosPagos = 0;
  vendasFiltradas.forEach(v => {
    if (v.status === 'PAGO') { faturamentoRecebido += Number(v.valor_pago); custoProdutosPagos += Number(v.custo_total); } 
    else if (v.status === 'FIADO') faturamentoFiado += Number(v.valor_total);
    else if (v.status === 'ENCOMENDA') faturamentoEncomenda += Number(v.valor_total);
  });
  const lucroReal = faturamentoRecebido - custoProdutosPagos;

  let produtoCampeao = "-"; let qtdCampeao = 0;
  if (vendasFiltradas.length > 0) {
    const ranking = {}; vendasFiltradas.forEach(v => { ranking[v.produto_nome] = (ranking[v.produto_nome] || 0) + Number(v.quantidade); });
    for (const [nome, qtd] of Object.entries(ranking)) { if (qtd > qtdCampeao) { produtoCampeao = nome; qtdCampeao = qtd; } }
  }

  // --- DADOS PARA O DASHBOARD BI ---
  const vendasPorDia = vendas.reduce((acc, v) => { const dataFormatada = formatDateBR(v.data_venda.substring(0, 10)); acc[dataFormatada] = (acc[dataFormatada] || 0) + Number(v.valor_total); return acc; }, {});
  const dadosGraficoLinha = Object.entries(vendasPorDia).map(([data, total]) => ({ data, total })).reverse(); 

  const faturamentoPorProduto = vendas.reduce((acc, v) => { acc[v.produto_nome] = (acc[v.produto_nome] || 0) + Number(v.valor_total); return acc; }, {});
  const dadosGraficoBarras = Object.entries(faturamentoPorProduto).map(([nome, faturamento]) => ({ nome, faturamento })).sort((a, b) => b.faturamento - a.faturamento).slice(0, 5);

  const vendasRaioX = vendas.filter(v => {
    let passaNome = true; let passaData = true;
    if (biClienteNome) passaNome = v.cliente.toLowerCase().includes(biClienteNome.toLowerCase());
    if (biDataInicio) passaData = v.data_venda.substring(0, 10) >= biDataInicio;
    if (biDataFim) passaData = passaData && (v.data_venda.substring(0, 10) <= biDataFim);
    return passaNome && passaData;
  });
  
  const biTotalGasto = vendasRaioX.reduce((acc, v) => acc + Number(v.valor_total), 0);
  const biTotalItens = vendasRaioX.reduce((acc, v) => acc + Number(v.quantidade), 0);
  const produtosRaioX = vendasRaioX.reduce((acc, v) => { acc[v.produto_nome] = (acc[v.produto_nome] || 0) + Number(v.valor_total); return acc; }, {});
  const dadosGraficoRaioX = Object.entries(produtosRaioX).map(([nome, total]) => ({ nome, total })).sort((a, b) => b.total - a.total);

  const listaFidelidadeAlertas = obterAlertasFidelidade();

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
              <button className={`btn ${paginaAtual === 'clientes' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setPaginaAtual('clientes'); setIsSidebarOpen(false); }} style={{ textAlign: 'left', padding: '12px' }}>👥 Cadastro de Clientes</button>
              <button className={`btn ${paginaAtual === 'dashboard' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setPaginaAtual('dashboard'); setIsSidebarOpen(false); }} style={{ textAlign: 'left', padding: '12px' }}>📊 Dashboard (BI)</button>
              <div style={{ marginTop: 'auto', paddingTop: '20px', borderTop: '1px solid #eee' }}><button className="btn btn-danger" style={{ width: '100%' }} onClick={handleLogout}>Sair do Sistema</button></div>
            </div>
          </div>
        </div>
      )}

      {/* CABEÇALHO */}
      <header style={{ display: 'flex', alignItems: 'center', background: '#2c3e50', padding: '12px 20px', color: 'white', borderRadius: '12px', marginBottom: '20px', gap: '20px' }}>
        <button onClick={() => setIsSidebarOpen(true)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'white', fontSize: '24px' }}>=</button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><img src="/logo.png" style={{ width: '38px', borderRadius: '8px', background: 'white' }} /><h1 style={{ margin: 0, fontSize: '1.4rem' }}>Vendas Vitória</h1></div>
      </header>
      
      {/* ======================= PÁGINA 1: VENDAS ======================= */}
      {paginaAtual === 'vendas' && (
        <>
          {fiadosAtrasados.length > 0 && (
            <div style={{ background: '#f8d7da', color: '#721c24', padding: '15px', borderRadius: '8px', marginBottom: '20px', borderLeft: '5px solid #dc3545', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div><strong>🚨 Cobrança Pendente!</strong><br/>{fiadosAtrasados.length} vendas em atraso.</div>
              {!filtroFiadoAtrasado && <button onClick={() => setFiltroFiadoAtrasado(true)} className="btn btn-danger">🔍 Filtrar</button>}
            </div>
          )}

          {/* BARRA DE FILTRO */}
          <div style={{ background: '#ffffff', padding: '15px', borderRadius: '8px', marginBottom: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
            <h4 style={{ margin: '0 0 10px 0', color: '#333' }}>
              Filtro de Período 
              {filtroFiadoAtrasado && <span style={{ color: '#dc3545', marginLeft: '10px' }}>- 🚨 Mostrando apenas devedores</span>}
            </h4>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" className="form-control" style={{ width: 'auto' }} value={dataInicioFiltro} onChange={(e) => setDataInicioFiltro(e.target.value)} disabled={filtroFiadoAtrasado} />
              <span style={{ fontWeight: 'bold' }}>até</span>
              <input type="date" className="form-control" style={{ width: 'auto' }} value={dataFimFiltro} onChange={(e) => setDataFimFiltro(e.target.value)} disabled={filtroFiadoAtrasado} />
              
              <button className="btn btn-primary" onClick={() => setFiltroAtivo(true)} disabled={!dataInicioFiltro || !dataFimFiltro || filtroFiadoAtrasado}>
                Filtrar
              </button>
              
              {(filtroAtivo || filtroFiadoAtrasado) && (
                <button className="btn btn-secondary" onClick={() => { setFiltroAtivo(false); setDataInicioFiltro(''); setDataFimFiltro(''); setFiltroFiadoAtrasado(false); }}>
                  Limpar Filtros
                </button>
              )}
            </div>
          </div>

          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ fontSize: '1.2rem', color: '#2c3e50', marginBottom: '15px', borderBottom: '2px solid #e9ecef', paddingBottom: '8px' }}>Visão Geral Financeira</h2>
            <div className="dashboard" style={{ marginBottom: '25px' }}>
              <div className="card caixa"><span className="title">💵 Recebido</span><span className="value">{formatCurrency(faturamentoRecebido)}</span></div>
              <div className="card fiado"><span className="title">⏳ A Receber</span><span className="value">{formatCurrency(faturamentoFiado)}</span></div>
              <div className="card custo"><span className="title">📉 Custo (Pagos)</span><span className="value">{formatCurrency(custoProdutosPagos)}</span></div>
              <div className="card lucro"><span className="title">📈 Lucro Real</span><span className="value">{formatCurrency(lucroReal)}</span></div>
            </div>
            <div className="dashboard">
              <div className="card extra"><span className="title">🙋‍♂️ Meus 90%</span><span className="value">{formatCurrency(lucroReal * 0.9)}</span></div>
              <div className="card extra"><span className="title">🏢 Empresa 10%</span><span className="value">{formatCurrency(lucroReal * 0.1)}</span></div>
              <div className="card destaque"><span className="title">🏆 Mais Vendido</span><span className="value" style={{ fontSize: '1.3rem' }}>{produtoCampeao} <small style={{fontSize: '0.8rem', color: '#6c757d', fontWeight: 'normal'}}>({qtdCampeao} un)</small></span></div>
            </div>
          </div>

          <div className="table-section" style={{ width: '100%', marginBottom: '100px' }}>
            <h2 style={{ marginBottom: '15px', color: '#2c3e50' }}>Histórico de Vendas</h2>
            <div className="historico-cards-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '15px' }}>
              {vendasFiltradas.map(v => (
                <div key={v.id} className="venda-card" style={{ background: 'white', borderRadius: '10px', padding: '15px', borderLeft: `5px solid ${v.status === 'PAGO' ? '#28a745' : v.status === 'FIADO' ? '#dc3545' : '#ffc107'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><h3 style={{ margin: 0 }}>{v.cliente}</h3><span className={`badge badge-${v.status.toLowerCase()}`}>{v.status}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 5px 0', color: '#666' }}><span>📅 {formatDateBR(v.data_venda)}</span><span>{v.produto_nome} (x{v.quantidade})</span></div>
                  
                  {v.observacao && <p style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic', margin: '0 0 10px 0' }}>Obs: {v.observacao}</p>}

                  {/* BARRA DE AÇÕES COM DESIGN LIMPO E ESPAÇADO */}
                  <div style={{ borderTop: '1px solid #eee', paddingTop: '12px', marginTop: '10px' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                      <span style={{ fontSize: '0.9rem', color: '#666' }}>Valor Total</span>
                      <span style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#1a1a1a' }}>{formatCurrency(v.valor_total)}</span>
                    </div>

                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'flex-end' }}>
                      
                      <button className="btn-sm" style={{ flex: '1 1 auto', background: '#f8f9fa', color: '#333', border: '1px solid #ddd', padding: '8px', borderRadius: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }} onClick={() => handleGerarRecibo(v)}>
                        🖨️ Recibo
                      </button>

                      {v.status === 'FIADO' && (
                        <button className="btn-sm" style={{ flex: '1 1 auto', background: '#25D366', color: 'white', border: 'none', padding: '8px', borderRadius: '6px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }} onClick={() => handleCobrarWhatsApp(v)}>
                          💬 Cobrar
                        </button>
                      )}

                      <button className="btn-sm" style={{ flex: '0 1 auto', background: '#e9ecef', color: '#333', border: 'none', padding: '8px 15px', borderRadius: '6px' }} onClick={() => handleEdit(v)} title="Editar Venda">✏️</button>
                      <button className="btn-sm" style={{ flex: '0 1 auto', background: '#fee2e2', color: '#dc3545', border: 'none', padding: '8px 15px', borderRadius: '6px' }} onClick={() => handleDelete(v.id)} title="Apagar Venda">🗑️</button>
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
            <button className="btn btn-primary" onClick={() => setIsProdutoModalOpen(true)}>+ Novo Produto</button>
          </div>
          <div className="historico-cards-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
            {produtos.map(p => {
              const estoqueCritico = p.estoque_atual <= p.estoque_minimo;
              const lucroReais = p.preco - p.custo;
              const margemLucro = p.preco > 0 ? (lucroReais / p.preco) * 100 : 0;

              return (
                <div key={p.id} className="venda-card" style={{ background: 'white', borderRadius: '10px', padding: '15px', opacity: p.ativo ? 1 : 0.6, borderLeft: `5px solid ${p.ativo ? (estoqueCritico ? '#dc3545' : '#17a2b8') : '#6c757d'}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: '1.2rem', textDecoration: !p.ativo ? 'line-through' : 'none' }}>{p.nome}</h3><span className="badge" style={{ background: p.ativo ? '#e9ecef' : '#6c757d', color: p.ativo ? '#333' : 'white' }}>{p.categoria}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', color: '#555' }}>
                    <span>Preço: <strong>{formatCurrency(p.preco)}</strong></span><span>Custo: {formatCurrency(p.custo)}</span>
                  </div>
                  
                  <div style={{ background: '#f1f8ff', padding: '10px', borderRadius: '6px', marginTop: '10px', border: '1px solid #cce5ff', fontSize: '0.9rem', display: 'flex', justifyContent: 'space-between' }}>
                    <span>Lucro Padrão: <strong>{formatCurrency(lucroReais)}</strong></span>
                    <span style={{ color: '#0056b3', fontWeight: 'bold' }}>Margem: {margemLucro.toFixed(1)}%</span>
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
            })}
          </div>
        </div>
      )}

      {/* ======================= PÁGINA 3: CLIENTES ======================= */}
      {paginaAtual === 'clientes' && (
        <div style={{ marginBottom: '100px' }}>
          
          <div style={{ background: '#fff3cd', color: '#856404', padding: '20px', borderRadius: '12px', marginBottom: '30px', borderLeft: '6px solid #ffc107', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 5px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>🎯 Alertas de Mini-Marketing (Fidelidade)</h3>
            <p style={{ margin: '0 0 15px 0', fontSize: '0.95rem', color: '#665214' }}>Clientes sumidos há mais de 45 dias. O sistema cruzou o histórico e já sugere o produto que eles mais adoram para renovar o estoque pessoal!</p>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(310px, 1fr))', gap: '12px' }}>
              {listaFidelidadeAlertas.length === 0 ? (
                <p style={{ fontStyle: 'italic', margin: 0, color: '#856404' }}>Nenhum cliente sumido por mais de 45 dias. Excelente engajamento!</p>
              ) : (
                listaFidelidadeAlertas.map(alerta => (
                  <div key={alerta.id} style={{ background: 'white', padding: '12px', borderRadius: '8px', border: '1px solid #ffeeba', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <strong style={{ color: '#333', fontSize: '1.05rem' }}>{alerta.nome}</strong>
                      <div style={{ fontSize: '0.85rem', color: '#721c24', fontWeight: 'bold', margin: '3px 0' }}>⚠️ Sumido(a) há {alerta.diasSumido} dias</div>
                      <p style={{ margin: '5px 0', fontSize: '0.9rem', color: '#555' }}>
                        Item de Afinidade: <span style={{ background: '#e2f0d9', color: '#385723', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>{alerta.produtoFavorito}</span> <small>({alerta.totalComprado} un)</small>
                      </p>
                    </div>
                    <button onClick={() => handleSugestaoFidelidadeWhats(alerta)} style={{ background: '#ffc107', color: '#333', border: 'none', padding: '8px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', marginTop: '10px', width: '100%' }}>
                      💡 Sugerir {alerta.produtoFavorito}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <h2 style={{ color: '#2c3e50', margin: 0 }}>👥 Lista Geral de Clientes</h2>
            <button className="btn btn-primary" onClick={() => setIsClienteModalOpen(true)}>+ Novo Cliente</button>
          </div>
          
          <div className="historico-cards-container" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '15px' }}>
            {clientes.length === 0 ? <p style={{ color: '#666' }}>Nenhum cliente cadastrado ainda. Salve uma venda ou clique acima para adicionar.</p> : null}
            {clientes.map(c => (
              <div key={c.id} className="venda-card" style={{ background: 'white', borderRadius: '10px', padding: '15px', borderLeft: `5px solid #007bff` }}>
                <h3 style={{ margin: '0 0 10px 0', fontSize: '1.2rem' }}>{c.nome}</h3>
                <p style={{ color: '#666', margin: 0 }}>📱 {c.telefone || 'Sem telefone cadastrado'}</p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '10px' }}>
                  <button className="btn-sm btn-primary" onClick={() => handleEditCliente(c)}>✏️ Editar / Adicionar Whats</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================= PÁGINA 4: DASHBOARD (BI) ======================= */}
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

          <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)', marginBottom: '20px' }}>
            <h3 style={{ margin: '0 0 15px 0', color: '#2c3e50' }}>🔍 Raio-X por Cliente</h3>
            
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginBottom: '20px' }}>
              <div>
                <label style={{display: 'block', fontSize: '0.9rem', color: '#666'}}>Nome do Cliente:</label>
                <input type="text" className="form-control" placeholder="Ex: Maria" value={biClienteNome} onChange={(e) => setBiClienteNome(e.target.value)} />
              </div>
              <div>
                <label style={{display: 'block', fontSize: '0.9rem', color: '#666'}}>Data Inicial:</label>
                <input type="date" className="form-control" value={biDataInicio} onChange={(e) => setBiDataInicio(e.target.value)} />
              </div>
              <div>
                <label style={{display: 'block', fontSize: '0.9rem', color: '#666'}}>Data Final:</label>
                <input type="date" className="form-control" value={biDataFim} onChange={(e) => setBiDataFim(e.target.value)} />
              </div>
            </div>

            <div style={{ background: '#e9f5ff', padding: '15px', borderRadius: '8px', border: '1px solid #b8daff', textAlign: 'center', marginBottom: '25px' }}>
              <p style={{ fontSize: '1.1rem', color: '#004085', margin: 0 }}>
                {biClienteNome ? `O cliente "${biClienteNome}"` : 'Na seleção atual, os clientes'} compraram <strong>{biTotalItens} produtos</strong> e gastaram um total de <strong>{formatCurrency(biTotalGasto)}</strong>.
              </p>
            </div>

            {dadosGraficoRaioX.length > 0 ? (
              <div style={{ width: '100%', height: 320 }}>
                <h4 style={{ margin: '0 0 10px 0', color: '#555', fontSize: '1rem', textAlign: 'center' }}>Distribuição de Gastos do Cliente</h4>
                <ResponsiveContainer>
                  <BarChart data={dadosGraficoRaioX} margin={{ top: 5, right: 20, bottom: 70, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="nome" tick={{fontSize: 10}} interval={0} angle={-45} textAnchor="end" height={70} />
                    <YAxis tickFormatter={(val) => `R$ ${val}`} tick={{fontSize: 12}} />
                    <Tooltip formatter={(value) => formatCurrency(value)} cursor={{fill: '#f8f9fa'}} />
                    <Bar dataKey="total" fill="#17a2b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p style={{textAlign: 'center', color: '#999'}}>Nenhuma venda encontrada para esse filtro.</p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: '20px' }}>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '1.1rem' }}>📈 Evolução de Vendas (R$)</h3>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <LineChart data={dadosGraficoLinha} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="data" tick={{fontSize: 12}} height={40} />
                    <YAxis tickFormatter={(val) => `R$ ${val}`} tick={{fontSize: 12}} />
                    <Tooltip formatter={(value) => formatCurrency(value)} labelStyle={{color: '#333'}} />
                    <Line type="monotone" dataKey="total" stroke="#007bff" strokeWidth={3} dot={{r: 4, fill: '#007bff'}} activeDot={{r: 6}} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.05)' }}>
              <h3 style={{ margin: '0 0 20px 0', color: '#2c3e50', fontSize: '1.1rem' }}>🏆 Top 5 Produtos</h3>
              <div style={{ width: '100%', height: 320 }}>
                <ResponsiveContainer>
                  <BarChart data={dadosGraficoBarras} margin={{ top: 5, right: 20, bottom: 70, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
                    <XAxis dataKey="nome" tick={{fontSize: 10}} interval={0} angle={-45} textAnchor="end" height={70} />
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

      {/* --- MODAIS DE INSERÇÃO --- */}
      
      {/* Venda */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={handleCloseModal}>✖</button>
            <h2 style={{ marginTop: 0 }}>{itemEditando ? 'Editar Venda' : 'Registrar Venda'}</h2>
            <form onSubmit={handleSaveVenda} style={{ marginTop: '20px' }}>
              <div className="form-group">
                <label>Nome do Cliente</label>
                <input type="text" name="cliente" className="form-control" placeholder="Digite o nome..." list="lista-clientes" value={formData.cliente} onChange={handleFormChange} required autoComplete="off" />
                <datalist id="lista-clientes">
                  {clientes.map(c => <option key={c.id} value={c.nome} />)}
                </datalist>
                <small style={{color: '#666'}}>Se for um nome novo, o sistema irá cadastrá-lo automaticamente.</small>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Data</label><input type="date" name="dataVenda" className="form-control" value={formData.dataVenda} onChange={handleFormChange} required /></div>
                <div className="form-group"><label>Status</label>
                  <select name="status" className="form-control" value={formData.status} onChange={handleFormChange} required><option value="PAGO">PAGO</option><option value="FIADO">FIADO</option><option value="ENCOMENDA">ENCOMENDA</option></select>
                </div>
              </div>
              <div className="form-group"><label>Produto</label>
                <select name="prodId" className="form-control" value={formData.prodId} onChange={handleFormChange} required>
                  <option value="">Selecione...</option>{produtos.filter(p => p.ativo).map(p => <option key={p.id} value={p.id}>{p.nome} (Estoque: {p.estoque_atual})</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Quantidade</label><input type="number" name="quantidade" className="form-control" min="1" value={formData.quantidade} onChange={handleFormChange} required /></div>
                
                <div className="form-group">
                  <label>Total Final (R$)</label>
                  <input type="number" step="0.01" name="valorCobrado" className="form-control font-bold" style={{ borderColor: '#007bff' }} value={formData.valorCobrado} onChange={handleFormChange} required />
                  <small style={{color: '#888'}}>Sugestão: {formatCurrency(getSugestaoValor())}</small>
                </div>
              </div>
              
              <div className="form-group">
                <label>Observação (Opcional)</label>
                <input type="text" name="observacao" className="form-control" placeholder="Tamanho, cor, combo 2x12..." value={formData.observacao} onChange={handleFormChange} />
              </div>

              <div className="form-buttons" style={{ display: 'flex', gap: '10px', marginTop: '20px' }}><button type="submit" className="btn-primary" style={{ flex: 1 }}>{itemEditando ? 'Salvar Edição' : 'Confirmar Venda'}</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Produto */}
      {isProdutoModalOpen && (
        <div className="modal-overlay" onClick={handleCloseProdutoModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={handleCloseProdutoModal}>✖</button>
            <h2 style={{ marginTop: 0 }}>{produtoEditando ? 'Editar Produto' : 'Novo Produto'}</h2>
            <form onSubmit={handleSaveProduto} style={{ marginTop: '20px' }}>
              <div className="form-group"><label>Nome do Produto</label><input type="text" name="nome" className="form-control" value={formProduto.nome} onChange={handleProdutoFormChange} required /></div>
              <div className="form-row">
                <div className="form-group"><label>Preço Venda (R$)</label><input type="number" step="0.01" name="preco" className="form-control" value={formProduto.preco} onChange={handleProdutoFormChange} required /></div>
                <div className="form-group"><label>Custo (R$)</label><input type="number" step="0.01" name="custo" className="form-control" value={formProduto.custo} onChange={handleProdutoFormChange} required /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Estoque</label><input type="number" name="estoque_atual" className="form-control" value={formProduto.estoque_atual} onChange={handleProdutoFormChange} required /></div>
                <div className="form-group"><label>Alerta Mín.</label><input type="number" name="estoque_minimo" className="form-control" value={formProduto.estoque_minimo} onChange={handleProdutoFormChange} required /></div>
              </div>
              <div className="form-buttons" style={{ marginTop: '20px' }}><button type="submit" className="btn-primary w-100">Salvar Produto</button></div>
            </form>
          </div>
        </div>
      )}

      {/* Cliente */}
      {isClienteModalOpen && (
        <div className="modal-overlay" onClick={handleCloseClienteModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="close-modal" onClick={handleCloseClienteModal}>✖</button>
            <h2 style={{ marginTop: 0 }}>{clienteEditando ? 'Editar Cliente' : 'Novo Cliente'}</h2>
            <form onSubmit={handleSaveCliente} style={{ marginTop: '20px' }}>
              <div className="form-group"><label>Nome Completo</label><input type="text" name="nome" className="form-control" value={formCliente.nome} onChange={handleClienteFormChange} required /></div>
              <div className="form-group"><label>Telefone / WhatsApp</label><input type="text" name="telefone" className="form-control" placeholder="(51) 99999-9999" value={formCliente.telefone} onChange={handleClienteFormChange} /></div>
              <div className="form-buttons" style={{ marginTop: '20px' }}><button type="submit" className="btn-primary w-100">Salvar Cliente</button></div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}