import React from 'react';
import Background from './Background.jsx';
import Drawing from './Drawing.jsx';
import Fog from './Fog.jsx';
import Overlay from './Overlay.jsx';
import ControlPanel from './ControlPanel.jsx';
import Token from './Token.jsx';
import Gamesocket from './Gamesocket.jsx';
import guid from './Guid.jsx';

class Game extends React.Component {

  constructor (props) {
    super(props);
    window.game = this;
    const params = new URLSearchParams(window.location.href.replace(/.*\?/, ''));
    this.isHost = params.get('host');
    this.room = params.get('room');
    this.websocket = new Gamesocket(this);
    this.cpRef = React.createRef();
    this.bgRef = React.createRef();
    this.fogRef = React.createRef();
    this.drawRef = React.createRef();
    this.overlayRef = React.createRef();
    this.tokens = React.createRef();
    this.state = {
      maps: {},
      tokens: [],
      cursors: {},
      cursorSize: 50,
      fogOpacity: 0.5,
      fogUrl: undefined, /* data url */
      fogRadius: 33,
      isFogLoaded: false,
      isFirstLoadDone: false, /* Ensure we don't overwrite localStorage before load is done */
      drawColor: 'purple',
      drawSize: 8,
      tool: 'move',
      username: this.isHost ? 'DM' : 'PC',
      'toggleOnShare mouse (cursor)': true,
    };
  }

  componentDidMount () {
    window.addEventListener('beforeunload', this.saveToLocalStorage.bind(this));
    window.addEventListener('resize', this.onResize.bind(this));
    window.addEventListener('keypress', this.onKeyPress.bind(this));
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    this.loadFromLocalStorage();
  }

  componentWillUnmount () {
    this.saveToLocalStorage();
    window.removeEventListener('beforeunload', this.saveToLocalStorage.bind(this));
    window.removeEventListener('resize', this.onResize.bind(this));
    window.removeEventListener('keypress', this.onKeyPress.bind(this));
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
  }

  initAsDev () {
    if (!window.confirm('Reset?')) return null;
    let tokens = [
      {name: 'bar', pc: 0},
      {name: 'foo', url: '/belmont.jpg'},
      {name: 'arr', pc: 1},
      {name: 'win', pc: 1, url: '/redhead.jpg', y: 50, x: 90, w: 64, h:64},
    ];
    let defaultMap = {
      url: "/FFtri9T.png",
      spawnX: 40, spawnY: 80, $id: 2,
    };
    let kiwiMap = {
      name: 'kiwi', url: '/kiwi.jpeg', $id: 1,
    };
    return new Promise(resolve => {
      this.setState({
        maps: Object.fromEntries([defaultMap, kiwiMap].map(m => [m.$id, m])),
        tokens: tokens,
        mapId: kiwiMap.$id,
      }, () => {
        this.loadMap();
        resolve();
      });
    });
  }

  updateTokens (callback, noEmit) {
    const tokensCopy = JSON.parse(JSON.stringify(this.state.tokens));
    tokensCopy.forEach(callback);
    this.setState({tokens: tokensCopy});
    if (!noEmit && this.websocket) this.websocket.pushTokens(tokensCopy);
  }

  updateToken (token, callback, noEmit) {
    const tokenIdx = this.state.tokens.indexOf(token);
    const tokensCopy = JSON.parse(JSON.stringify(this.state.tokens));
    const tokenCopy = tokensCopy[tokenIdx];
    callback(tokenCopy, tokenIdx, tokensCopy);
    this.setState({tokens: tokensCopy});
    if (!noEmit && this.websocket) this.websocket.pushToken(tokenIdx, tokenCopy);
  }

  updateTokenByIndex (index, attrs, noEmit) {
    const tokensCopy = JSON.parse(JSON.stringify(this.state.tokens));
    const tokenCopy = Object.assign(tokensCopy[index], attrs);
    this.setState({tokens: tokensCopy});
    if (!noEmit && this.websocket) this.websocket.pushToken(index, tokenCopy);
  }

  /* Mutate object to remove keys that begin with `$` */
  scrubObject (object) {
    for (let key in object) if (/^\$/.test(key) && key !== '$id') delete object[key];
  }

  selectToken (token, trueFalse, multiSelect) {
    if (!token.pc && !this.isHost) return;
    const tokenIdx = this.state.tokens.indexOf(token);
    this.updateTokens((copy, $i) => {
      if (tokenIdx === $i) {
        if (trueFalse === undefined || trueFalse === null) trueFalse = !copy.$selected;
        copy.$selected = trueFalse;
      } else if (!multiSelect)
        copy.$selected = false;
      if (copy.$selected) { /* set initial coords (for drag) */
        copy.$x0 = copy.x;
        copy.$y0 = copy.y;
      }
    }, true);
  }

  dragSelectedTokens (evt) {
    if (this.state.tool !== 'move') return;
    const downX = this.state.downX, downY = this.state.downY;
    this.updateTokens(token => {
      if (token.$selected) {
        token.x = token.$x0 + evt.pageX - downX;
        token.y = token.$y0 + evt.pageY - downY;
      }
    });
  }

  /* Callback when the window resizes */
  onResize () { this.loadMap(null, true, true) }

  onKeyDown (evt) {
    for (let x of [document.activeElement, evt.target])
      if (x.tagName == 'INPUT' && (x.type === 'text' || x.type === 'number')) /* eslint-disable-line eqeqeq */
        return evt;
    const moveFactor = evt.shiftKey ? 100 : 10;
    const moveSelectedTokens = () => {
      this.updateTokens(token => {
        if (token.$selected) {
          switch (evt.keyCode) {
            case 27: token.$selected = false; break; /* escape */
            case 37: token.x -= moveFactor; break; /* left */
            case 38: token.y -= moveFactor; break; /* up */
            case 39: token.x += moveFactor; break; /* right */
            case 40: token.y += moveFactor; break; /* down */
            default: return;
          }
          evt.preventDefault();
        }
      });
    }
    switch (evt.keyCode) {
      case 27:
      case 37:
      case 38:
      case 39:
      case 40: moveSelectedTokens(evt); break;
      default: return;
    }
  }

  onKeyPress (evt) {
    if (!this.isHost) return evt;
    for (let x of [document.activeElement, evt.target])
      if (x.tagName == 'INPUT' && (x.type === 'text' || x.type === 'number')) /* eslint-disable-line eqeqeq */
        return evt;
    function toggle (key, location) {
      (location||this).setState({[key]: !(location||this).state[key]});
    }
    const cp = this.cpRef.current;
    switch(evt.code) {
      case 'KeyC':
        if (evt.shiftKey) cp.copyJson(); /* dump json to clipboard */
        break;
      case 'KeyH': toggle('hidden', cp); break;
      case 'KeyG': this.setState({tool: 'fog'}); break;
      case 'KeyL':
        if (evt.shiftKey) this.loadFromLocalStorage();
        else this.saveToLocalStorage();
        break;
      case 'KeyM': toggle('toggleOnMaps', cp); break;
      case 'KeyP': this.setState({tool: 'draw'}); break;
      case 'KeyT': toggle('toggleOnTokens', cp); break;
      case 'KeyV':
        if (evt.shiftKey) cp.pasteJson(); /* load json from clipboard */
        else this.setState({tool: 'move'});
        break;
      default: return
    }
  }

  onMouseUp (evt) {
    this.updateTokens(tok => {
      tok.$x0 = tok.x;
      tok.$y0 = tok.y;
    }, true);
    this.setState({
      lastX: undefined, lastY: undefined,
    });
    this.overlayRef.current.setState({
      lastX: undefined, lastY: undefined,
    });
  }

  onMouseDown (evt) {
    if (evt.buttons & 1) {
      if (!/(\s|^)token(\s|$)/.test(evt.target.getAttribute('class')))
        this.updateTokens(tok => {delete tok.$selected});
      this.setState({
        lastX: evt.pageX, lastY: evt.pageY,
        downX: evt.pageX, downY: evt.pageY,
      });
    }
  }

  onMouseMove (evt) {
    const overlay = this.overlayRef.current;
    if (overlay.canvasRef && overlay.canvasRef.current) overlay.clear();
    let x = evt.pageX, y = evt.pageY;
    switch (this.isHost ? this.state.tool : 'move') {
      case 'fog':
        if (evt.buttons & 1) overlay.fogErase(x, y);
        overlay.setPointerOutline(x, y, 'yellow', this.state.fogRadius);
        break;
      case 'draw':
        if (evt.buttons & 1) overlay.drawOrErase(x, y);
        overlay.setPointerOutline(x, y, this.state.drawColor, this.state.drawSize);
        break;
      case 'move':
        if (evt.buttons & 1) this.dragSelectedTokens(evt);
        break;
      default: break;
    }
    this.setState({lastX: evt.pageX, lastY: evt.pageY});
    if (this.websocket && this.state['toggleOnShare mouse (cursor)'])
      this.websocket.pushCursor(evt.pageX, evt.pageY);
  }

  notify (msg, ttl, tag) {
    console.log(msg);
    if (window.Notification) {
      if (window.Notification.permission !== 'granted')
        window.Notification.requestPermission();
      else {
        const note = new window.Notification(msg, {tag: tag});
        setTimeout(() => note.close(), ttl || 1000);
        return note;
      }
    }
  }

  updateCursors (x, y, name, guid) {
    const cursors = Object.assign({}, this.state.cursors);
    cursors[guid] = { x: x, y: y, time: new Date(), u: name };
    this.setState({cursors: cursors});
  }

  updateMap (callback) {
    return new Promise(resolve => {
      const mapsCopy = JSON.parse(JSON.stringify(this.state.maps));
      callback(mapsCopy[this.state.mapId]);
      this.setState({maps: mapsCopy}, resolve);
    });
  }

  dumpCanvas (which) {
    const changedAt = this.map[`$${which}ChangedAt`];
    const dumpedAt = this.map[`$${which}DumpedAt`];
    if (this.isHost && changedAt && (!dumpedAt || dumpedAt < changedAt)) {
      const at = new Date();
      const url = this[`${which}Ref`].current.buildDataUrl();
      console.log('dumped', which, url);
      return [url, at];
    }
    else return [this.map[`${which}Url`], dumpedAt];
  }

  /* Copy maps and dump current data urls, suitable for save to state or localStorage */
  dumpMaps () {
    console.log('dumpMaps')
    let mapId = this.state.mapId;
    /* Infer map id if it's not set */
    if (undefined === mapId) mapId = Object.keys(this.state.maps).find(key => this.state.maps[key] === this.map);
    const mapsCopy = JSON.parse(JSON.stringify(this.state.maps));
    const map = mapsCopy[mapId];
    if (map && this.state.isFirstLoadDone) { /* Map may have been deleted */
      this.notify('Building data urls...', undefined, 'dumpMaps');
      [map.fogUrl, map.$fogDumpedAt] = this.dumpCanvas('fog');
      [map.drawUrl, map.$drawDumpedAt] = this.dumpCanvas('draw');
      this.notify('Data urls readied', undefined, 'dumpMaps');
    }
    return mapsCopy;
  }

  /* From playarea to state */
  saveMap () {
    return new Promise((resolve, reject) => {
      this.setState({ maps: this.dumpMaps() }, resolve);
    });
  }

  /* From state to playarea */
  loadMap (map, skipSave, noEmit) {
    if (!map) map = this.map;
    if (!map) return Promise.reject('no map');
    const note = this.notify(`loading map ${map.$id}...`, 6000, 'loadMap');
    if (undefined === map.$id) map.$id = Object.keys(this.state.maps).find(key => this.state.maps[key] === this.map);
    const needsSave = this.isHost && this.state.isFirstLoadDone && !skipSave;
    const savePromise = needsSave ? this.saveMap() : Promise.resolve();
    if (!noEmit && this.isHost && this.websocket) this.websocket.pushMapId(map.$id);
    const startStateAttrs = { mapId: map.$id, isFogLoaded: false };
    const finishStateAttrs = { isFirstLoadDone: true, isFogLoaded: true };
    return savePromise.then(() => {
      return new Promise((resolve, reject) => {
        this.setState(startStateAttrs, () => {
          /* Load bg first because that resizes the canvases */
          this.bgRef.current.load().then(() => {
            Promise.all([
              this.fogRef.current.load(),
              this.drawRef.current.load(),
            ]).then(() => {
              this.setState(finishStateAttrs, () => {
                resolve();
                note && note.close();
                this.notify('map loaded', undefined, 'loadMap');
              });
            }).catch(arg => {
              console.error('fail loads:', arg);
              this.setState(finishStateAttrs);
            });
          }).catch(arg => {
            console.error('fail load bgRef:', arg);
            this.setState(finishStateAttrs);
          });
        });
      });
    }).catch(arg => {
      console.error('fail savePromise:', arg);
      this.setState(finishStateAttrs);
    });
  }

  toJson (additionalAttrs) {
    const newGeneration = 1 + (this.state.gen || 0);
    if (this.isHost) this.setState({gen: newGeneration}); /* Generation is tracked so that we don't get refresh loops when multiple DMs exist. */
    const tokens = this.state.tokens.map(token => ({...token}));
    tokens.forEach(token => this.scrubObject(token));
    const maps = this.dumpMaps();
    Object.values(maps).forEach(map => this.scrubObject(map));
    const data = Object.assign({
      gen: newGeneration,
      maps: maps,
      mapId: this.map && this.map.$id,
      tokens: tokens,
    }, additionalAttrs);
    return JSON.stringify(data);
  }

  fromJson (json) {
    const data = Object.assign(JSON.parse(json)||{});
    if (data.tokens) {
      data.tokens.forEach(token => { if (!token.guid) token.guid = guid() });
    }
    return new Promise(resolve => {
      this.setState(data, () => this.loadMap().then(resolve));
    });
  }

  saveToLocalStorage () {
    if (this.state.isFirstLoadDone) {
      console.log('Saving game to local storage');
      localStorage.setItem(this.room, this.toJson());
    }
  }

  loadFromLocalStorage () {
    console.log('Loading game from local storage');
    return this.fromJson(localStorage.getItem(this.room));
  }

  get map () {
    let map = this.state.maps[this.state.mapId];
    return map || Object.values(this.state.maps)[0];
  }

  render () {
    const goneKlass = this.state.isFogLoaded ? null : 'gone';
    try {
      return (
        <div id="game" onMouseMove={this.onMouseMove.bind(this)} onMouseDown={this.onMouseDown.bind(this)} onMouseUp={this.onMouseUp.bind(this)}>
          <div className={goneKlass}>
            <Background game={this} ref={this.bgRef} className={goneKlass} />
            <Drawing game={this} ref={this.drawRef} />
            {this.renderTokens()}
            <Fog game={this} ref={this.fogRef} />
            {this.renderCursors()}
            <Overlay game={this} ref={this.overlayRef} />{/* Holds outline for fog & draw tools */}
          </div>
          <ControlPanel game={this} ref={this.cpRef} />
        </div>
      );
    } catch (ex) { handleError(ex) }
  }

  renderCursors () {
    const deadline = new Date() - 30000;
    const cursors = Object.assign({}, this.state.cursors);
    for (let name in cursors) {
      let time = cursors[name].time;
      if (!time || time < deadline) delete cursors[name];
    }
    return (<div id="cursors">
      {Object.keys(cursors).map((key, $i) => (
        <Cursor key={`cursor${$i}`} name={key} cursor={cursors[key]} size={this.state.cursorSize} />
      ))}
    </div>);
  }

  renderTokens () {
    try {
      return <div id="tokens">
        {this.state.tokens.map((token, $i) => (
          <Token key={`Token${$i}`} token={token} game={this} />
        ))}
      </div>;
    } catch (ex) { handleError(ex) }
  }
}
export default Game;

function Cursor (props) {
  const cur = props.cursor;
  const divStyle = {
    top: cur.y, left: cur.x,
  };
  const imgStyle = {
    fontSize: props.size || undefined,
  };
  return <div style={divStyle} className="cursor">
    <span role="img" aria-label="pointer" style={imgStyle}>&#x1f5e1;</span>
    {cur.u || props.name}
  </div>
}

function handleError (ex) {
  console.error(ex);
  console.error('Exception in `render`. Clearing localStorage...');
  localStorage.removeItem(this.room);
  window.alert('Fatal error. Local storage cleared.');
}
