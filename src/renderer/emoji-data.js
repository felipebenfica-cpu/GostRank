/* Ghost Rank — dados de emoji para o chat (frente R2).
   Cada item: [emoji, 'nome-curto palavras de busca em pt-BR']. O primeiro termo é o nome usado no :autocompletar:. */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'pessoas', label: 'Carinhas e pessoas', icon: '😀', items: [
      ['😀', 'sorriso feliz alegre'], ['😃', 'sorrisao feliz'], ['😄', 'sorrindo olhos feliz'], ['😁', 'dentes sorriso'],
      ['😆', 'rindo forte'], ['😅', 'suor riso nervoso'], ['🤣', 'rolando de rir kkk'], ['😂', 'chorando de rir kkk lagrimas'],
      ['🙂', 'leve sorriso'], ['🙃', 'cabeca para baixo ironia'], ['😉', 'piscadinha piscar'], ['😊', 'corado feliz'],
      ['😇', 'anjo inocente'], ['🥰', 'apaixonado coracoes'], ['😍', 'olhos de coracao amor'], ['🤩', 'estrela deslumbrado'],
      ['😘', 'beijo'], ['😗', 'beijinho'], ['😚', 'beijo olhos fechados'], ['😋', 'gostoso delicia lingua'],
      ['😛', 'lingua de fora'], ['😜', 'piscando lingua'], ['🤪', 'maluco doido'], ['😝', 'lingua olhos fechados'],
      ['🤑', 'dinheiro rico'], ['🤗', 'abraco'], ['🤭', 'mao na boca risadinha'], ['🤫', 'silencio shh'],
      ['🤔', 'pensando hmm'], ['🤐', 'boca fechada ziper'], ['🤨', 'sobrancelha desconfiado'], ['😐', 'neutro serio'],
      ['😑', 'sem expressao'], ['😶', 'sem boca mudo'], ['😏', 'sorriso de lado malicia'], ['😒', 'chateado desdem'],
      ['🙄', 'revirar olhos'], ['😬', 'careta tenso'], ['🤥', 'mentiroso'], ['😌', 'aliviado'],
      ['😔', 'pensativo triste'], ['😪', 'sonolento'], ['🤤', 'babando'], ['😴', 'dormindo sono zzz'],
      ['😷', 'mascara doente'], ['🤒', 'febre termometro'], ['🤕', 'machucado'], ['🤢', 'enjoado nausea'],
      ['🤮', 'vomitando'], ['🤧', 'espirro'], ['🥵', 'calor quente'], ['🥶', 'frio congelando'],
      ['🥴', 'tonto zonzo'], ['😵', 'atordoado'], ['🤯', 'cabeca explodindo mente'], ['🤠', 'cowboy chapeu'],
      ['🥳', 'festa comemorando'], ['😎', 'oculos escuros estiloso legal'], ['🤓', 'nerd'], ['🧐', 'monoculo analisando'],
      ['😕', 'confuso'], ['😟', 'preocupado'], ['🙁', 'levemente triste'], ['😮', 'boca aberta surpreso'],
      ['😯', 'espantado'], ['😲', 'chocado'], ['😳', 'envergonhado corado'], ['🥺', 'pidao olhinhos'],
      ['😦', 'franzido'], ['😧', 'angustiado'], ['😨', 'medo'], ['😰', 'ansioso suor'],
      ['😥', 'decepcionado aliviado'], ['😢', 'chorando lagrima'], ['😭', 'chorando muito'], ['😱', 'gritando de medo'],
      ['😖', 'confuso frustrado'], ['😣', 'perseverante'], ['😞', 'desapontado'], ['😓', 'suor frio'],
      ['😩', 'cansado exausto'], ['😫', 'muito cansado'], ['🥱', 'bocejo tedio'], ['😤', 'bufando triunfo'],
      ['😡', 'bravo raiva'], ['😠', 'irritado'], ['🤬', 'xingando palavrao'], ['😈', 'diabinho sorrindo'],
      ['👿', 'diabo bravo'], ['💀', 'caveira morri'], ['☠️', 'caveira ossos'], ['💩', 'coco'],
      ['🤡', 'palhaco'], ['👹', 'ogro'], ['👻', 'fantasma ghost'], ['👽', 'alien et'],
      ['🤖', 'robo bot'], ['😺', 'gato sorrindo'], ['🙈', 'macaco nao vejo'], ['🙉', 'macaco nao ouco'],
      ['🙊', 'macaco nao falo']
    ] },
    { id: 'gestos', label: 'Gestos e corpo', icon: '👍', items: [
      ['👋', 'tchau oi aceno'], ['🤚', 'mao levantada'], ['✋', 'mao aberta pare'], ['🖖', 'vulcano'],
      ['👌', 'ok perfeito'], ['🤌', 'italiano'], ['🤏', 'pouquinho'], ['✌️', 'paz vitoria'],
      ['🤞', 'dedos cruzados sorte'], ['🤟', 'te amo'], ['🤘', 'rock'], ['🤙', 'me liga'],
      ['👈', 'esquerda'], ['👉', 'direita'], ['👆', 'cima'], ['👇', 'baixo'],
      ['☝️', 'indicador'], ['👍', 'joinha positivo curti like'], ['👎', 'negativo nao curti dislike'], ['✊', 'punho'],
      ['👊', 'soco'], ['🤛', 'soquinho esquerda'], ['🤜', 'soquinho direita'], ['👏', 'palmas aplausos'],
      ['🙌', 'maos para cima celebrar'], ['👐', 'maos abertas'], ['🤲', 'palmas juntas'], ['🤝', 'aperto de mao acordo'],
      ['🙏', 'por favor obrigado reza'], ['✍️', 'escrevendo'], ['💪', 'forca musculo biceps'], ['🦾', 'braco mecanico'],
      ['🧠', 'cerebro'], ['👀', 'olhos olhando'], ['👁️', 'olho'], ['👅', 'lingua'],
      ['👄', 'boca'], ['🫡', 'continencia saudacao'], ['🫶', 'coracao com maos'], ['🤷', 'sei la tanto faz'],
      ['🤦', 'facepalm mao na cara'], ['🙋', 'levantando a mao'], ['🙇', 'reverencia'], ['💁', 'informacao']
    ] },
    { id: 'coracoes', label: 'Corações e símbolos', icon: '❤️', items: [
      ['❤️', 'coracao vermelho amor'], ['🧡', 'coracao laranja'], ['💛', 'coracao amarelo'], ['💚', 'coracao verde'],
      ['💙', 'coracao azul'], ['💜', 'coracao roxo'], ['🖤', 'coracao preto'], ['🤍', 'coracao branco'],
      ['🤎', 'coracao marrom'], ['💔', 'coracao partido'], ['❣️', 'exclamacao coracao'], ['💕', 'dois coracoes'],
      ['💞', 'coracoes girando'], ['💓', 'coracao batendo'], ['💗', 'coracao crescendo'], ['💖', 'coracao brilhante'],
      ['💘', 'flecha cupido'], ['💝', 'coracao presente'], ['💯', 'cem cem por cento'], ['💢', 'raiva simbolo'],
      ['💥', 'explosao colisao'], ['💫', 'tonto estrela'], ['💦', 'gotas suor'], ['💨', 'correndo vento'],
      ['💬', 'balao fala'], ['💭', 'balao pensamento'], ['💤', 'zzz sono'], ['✅', 'certo check feito'],
      ['☑️', 'caixa marcada'], ['✔️', 'visto'], ['❌', 'x errado nao'], ['❎', 'x quadrado'],
      ['➕', 'mais'], ['➖', 'menos'], ['❓', 'pergunta interrogacao'], ['❗', 'exclamacao'],
      ['‼️', 'dupla exclamacao'], ['⁉️', 'exclamacao pergunta'], ['⚠️', 'aviso cuidado'], ['🚫', 'proibido'],
      ['⛔', 'entrada proibida'], ['🔞', 'mais de 18'], ['♻️', 'reciclar'], ['🔥', 'fogo top brabo'],
      ['✨', 'brilho'], ['⭐', 'estrela'], ['🌟', 'estrela brilhante'], ['⚡', 'raio energia'],
      ['🎵', 'nota musical'], ['🎶', 'musica notas'], ['🔔', 'sino notificacao'], ['🔕', 'sino mudo'],
      ['📢', 'megafone anuncio'], ['📌', 'tachinha fixar'], ['🔗', 'link corrente'], ['🆗', 'ok botao'],
      ['🆕', 'novo'], ['🆒', 'cool'], ['🔴', 'circulo vermelho'], ['🟢', 'circulo verde'],
      ['🔵', 'circulo azul'], ['🟡', 'circulo amarelo'], ['⚫', 'circulo preto'], ['⚪', 'circulo branco']
    ] },
    { id: 'jogos', label: 'Jogos e atividades', icon: '🎮', items: [
      ['🎮', 'controle videogame jogo'], ['🕹️', 'joystick arcade'], ['👾', 'invasor pixel'], ['🎯', 'alvo na mosca'],
      ['🎲', 'dado sorte'], ['♟️', 'xadrez peao'], ['🧩', 'quebra cabeca'], ['🃏', 'coringa carta'],
      ['🏆', 'trofeu campeao vitoria'], ['🥇', 'medalha ouro primeiro'], ['🥈', 'medalha prata segundo'], ['🥉', 'medalha bronze terceiro'],
      ['🏅', 'medalha'], ['🎖️', 'condecoracao'], ['⚔️', 'espadas luta'], ['🗡️', 'adaga'],
      ['🛡️', 'escudo defesa'], ['🏹', 'arco flecha'], ['🪄', 'varinha magia'], ['🔮', 'bola de cristal'],
      ['🧙', 'mago'], ['🧝', 'elfo'], ['🧛', 'vampiro'], ['🧟', 'zumbi'],
      ['🐉', 'dragao'], ['👑', 'coroa rei'], ['💎', 'diamante gema'], ['💰', 'saco de dinheiro ouro'],
      ['🪙', 'moeda'], ['⚽', 'futebol bola'], ['🏀', 'basquete'], ['🏈', 'futebol americano'],
      ['⚾', 'beisebol'], ['🎾', 'tenis'], ['🏐', 'volei'], ['🥊', 'boxe luva'],
      ['🎉', 'festa confete parabens'], ['🎊', 'confete bola'], ['🎈', 'balao'], ['🎁', 'presente'],
      ['🎂', 'bolo aniversario'], ['🎤', 'microfone karaoke'], ['🎧', 'fone de ouvido'], ['📺', 'televisao'],
      ['📷', 'camera foto'], ['🎬', 'claquete filme'], ['🖥️', 'computador desktop'], ['💻', 'notebook'],
      ['⌨️', 'teclado'], ['🖱️', 'mouse'], ['📱', 'celular'], ['🔊', 'som alto'],
      ['🔇', 'mudo sem som'], ['🎙️', 'microfone estudio'], ['📡', 'antena'], ['🔋', 'bateria'],
      ['⏰', 'despertador'], ['⌛', 'ampulheta'], ['📈', 'grafico subindo'], ['📉', 'grafico caindo'],
      ['🚀', 'foguete'], ['💣', 'bomba'], ['🧨', 'dinamite'], ['🪦', 'lapide rip']
    ] },
    { id: 'natureza', label: 'Animais e natureza', icon: '🐶', items: [
      ['🐶', 'cachorro cao'], ['🐱', 'gato'], ['🐭', 'rato'], ['🐹', 'hamster'],
      ['🐰', 'coelho'], ['🦊', 'raposa'], ['🐻', 'urso'], ['🐼', 'panda'],
      ['🐨', 'coala'], ['🐯', 'tigre'], ['🦁', 'leao'], ['🐮', 'vaca'],
      ['🐷', 'porco'], ['🐸', 'sapo'], ['🐵', 'macaco'], ['🐔', 'galinha'],
      ['🐧', 'pinguim'], ['🐦', 'passaro'], ['🦅', 'aguia'], ['🦉', 'coruja'],
      ['🦇', 'morcego'], ['🐺', 'lobo'], ['🐗', 'javali'], ['🐴', 'cavalo'],
      ['🦄', 'unicornio'], ['🐝', 'abelha'], ['🐛', 'lagarta'], ['🦋', 'borboleta'],
      ['🐌', 'caracol lento'], ['🐞', 'joaninha'], ['🕷️', 'aranha'], ['🦂', 'escorpiao'],
      ['🐢', 'tartaruga'], ['🐍', 'cobra'], ['🦎', 'lagarto'], ['🦖', 'dinossauro'],
      ['🐙', 'polvo'], ['🦈', 'tubarao'], ['🐬', 'golfinho'], ['🐳', 'baleia'],
      ['🌵', 'cacto'], ['🌲', 'pinheiro arvore'], ['🌴', 'palmeira'], ['🍀', 'trevo sorte'],
      ['🍁', 'folha bordo'], ['🌸', 'flor cerejeira'], ['🌹', 'rosa'], ['🌻', 'girassol'],
      ['🌞', 'sol sorrindo'], ['🌙', 'lua'], ['⛅', 'nublado'], ['🌧️', 'chuva'],
      ['⛈️', 'tempestade'], ['❄️', 'neve floco'], ['🌈', 'arco iris'], ['🌊', 'onda mar'],
      ['🌍', 'mundo terra'], ['🪐', 'planeta saturno']
    ] },
    { id: 'comida', label: 'Comidas e bebidas', icon: '🍕', items: [
      ['🍎', 'maca'], ['🍌', 'banana'], ['🍉', 'melancia'], ['🍇', 'uva'],
      ['🍓', 'morango'], ['🍒', 'cereja'], ['🍑', 'pessego'], ['🍍', 'abacaxi'],
      ['🥑', 'abacate'], ['🌶️', 'pimenta'], ['🌽', 'milho'], ['🥕', 'cenoura'],
      ['🍞', 'pao'], ['🧀', 'queijo'], ['🥚', 'ovo'], ['🥓', 'bacon'],
      ['🍔', 'hamburguer lanche'], ['🍟', 'batata frita'], ['🍕', 'pizza'], ['🌭', 'cachorro quente'],
      ['🌮', 'taco'], ['🍝', 'macarrao'], ['🍜', 'lamen'], ['🍣', 'sushi'],
      ['🍦', 'sorvete'], ['🍩', 'rosquinha donut'], ['🍪', 'biscoito cookie'], ['🍫', 'chocolate'],
      ['🍿', 'pipoca'], ['🧃', 'suco caixinha'], ['☕', 'cafe'], ['🍵', 'cha'],
      ['🥤', 'refrigerante copo'], ['🍺', 'cerveja'], ['🍻', 'brinde cervejas'], ['🍷', 'vinho'],
      ['🥂', 'brinde tacas'], ['🧉', 'chimarrao mate'], ['🥩', 'carne churrasco'], ['🍗', 'coxa frango']
    ] },
    { id: 'objetos', label: 'Viagens e objetos', icon: '🚗', items: [
      ['🚗', 'carro'], ['🏎️', 'carro de corrida'], ['🚓', 'policia viatura'], ['🚑', 'ambulancia'],
      ['🚒', 'bombeiros'], ['🚌', 'onibus'], ['🚲', 'bicicleta'], ['🛵', 'moto scooter'],
      ['✈️', 'aviao'], ['🛸', 'disco voador ovni'], ['🚢', 'navio'], ['🏠', 'casa'],
      ['🏰', 'castelo'], ['🗺️', 'mapa'], ['🧭', 'bussola'], ['⛺', 'barraca'],
      ['💡', 'lampada ideia'], ['🔦', 'lanterna'], ['🕯️', 'vela'], ['📦', 'caixa pacote'],
      ['📝', 'anotacao memo'], ['📎', 'clipe anexo'], ['✂️', 'tesoura'], ['🔒', 'cadeado fechado'],
      ['🔓', 'cadeado aberto'], ['🔑', 'chave'], ['🔨', 'martelo'], ['🛠️', 'ferramentas'],
      ['⚙️', 'engrenagem configuracao'], ['🧲', 'ima'], ['🧪', 'tubo de ensaio'], ['💊', 'remedio pilula'],
      ['🚪', 'porta'], ['🛏️', 'cama'], ['🚽', 'privada'], ['🧻', 'papel higienico'],
      ['🗑️', 'lixeira'], ['📅', 'calendario'], ['📊', 'grafico barras'], ['📚', 'livros']
    ] }
  ];

  var ALL = [];
  CATEGORIES.forEach(function (c) {
    c.items.forEach(function (it) {
      ALL.push({ emoji: it[0], name: it[1].split(' ')[0], terms: it[1], category: c.id });
    });
  });

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  /** Busca por nome/termos (sem acento). Prefixo do nome primeiro. */
  function search(query, limit) {
    var q = norm(query).trim();
    var max = limit || 48;
    if (!q) return ALL.slice(0, max);
    var starts = [];
    var contains = [];
    for (var i = 0; i < ALL.length; i++) {
      var e = ALL[i];
      if (e.name.indexOf(q) === 0) starts.push(e);
      else if (e.terms.indexOf(q) !== -1) contains.push(e);
    }
    return starts.concat(contains).slice(0, max);
  }

  function byName(name) {
    var n = norm(name);
    for (var i = 0; i < ALL.length; i++) if (ALL[i].name === n) return ALL[i];
    return null;
  }

  window.GhostEmoji = Object.freeze({ categories: CATEGORIES, all: ALL, search: search, byName: byName });
})();
