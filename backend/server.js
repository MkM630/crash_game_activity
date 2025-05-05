const mongoose = require("mongoose");
mongoose.set('useFindAndModify', false);
const express = require("express");
const cors = require("cors");
const passport = require("passport");
const passportLocal = require("passport-local").Strategy;
const cookieParser = require("cookie-parser");
const bcrypt = require("bcryptjs");
const session = require("express-session");
const bodyParser = require("body-parser");
const app = express();
const User = require("./models/user");
const Game_loop = require("./models/game_loop")
require('dotenv').config()

const GAME_LOOP_ID = '62b7e66b1da7901bfc65df0d'

const { Server } = require('socket.io')
const http = require('http')
const Stopwatch = require('statman-stopwatch');
const { update } = require("./models/user");
const sw = new Stopwatch(true);

// Start Socket.io Server
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
})

io.on("connection", (socket) => {
  socket.on("clicked", (data) => {
  })
})

server.listen(3001, () => {
  console.log("Socket.IO server running on port 3001");
})

// Connect to MongoDB 
mongoose.connect(
  process.env.MONGOOSE_DB_LINK,
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  },
);

// Initialize game loop document if it doesn't exist
async function initializeGameLoop() {
  try {
    const existingLoop = await Game_loop.findById(GAME_LOOP_ID);
    if (!existingLoop) {
      const newGameLoop = new Game_loop({
        _id: GAME_LOOP_ID,
        multiplier_crash: 1,
        previous_crashes: [],
        round_id_list: [1],
        active_player_id_list: [],
        chat_messages_list: []
      });
      await newGameLoop.save();
      console.log('Created new game loop document');
    }
  } catch (err) {
    console.error('Error initializing game loop:', err);
  }
}

// Backend Setup
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(
  session({
    secret: process.env.PASSPORT_SECRET,
    resave: true,
    saveUninitialized: true,
  })
);
app.use(cookieParser(process.env.PASSPORT_SECRET));
app.use(passport.initialize());
app.use(passport.session());
require("./passportConfig")(passport);

// Call initialization after MongoDB connection is established
mongoose.connection.once('open', () => {
  initializeGameLoop();
});

//Passport.js login/register system
app.post("/login", (req, res, next) => {
  passport.authenticate("local", (err, user, info) => {
    if (err) throw err;
    if (!user) {
      res.send("Username or Password is Wrong")
    }
    else {
      req.logIn(user, (err) => {
        if (err) throw err;
        res.send("Login Successful");
      });
    }
  })(req, res, next);
});

app.post("/register", (req, res) => {
  if (req.body.username.length < 3 || req.body.password < 3) {
    return
  }

  User.findOne({ username: req.body.username }, async (err, doc) => {
    if (err) throw err;
    if (doc) res.send("Username already exists");
    if (!doc) {
      const hashedPassword = await bcrypt.hash(req.body.password, 10);

      const newUser = new User({
        username: req.body.username,
        password: hashedPassword,
      });
      await newUser.save();
      res.send("Loading...");
    }
  });
});

// Routes
app.get("/user", checkAuthenticated, (req, res) => {
  res.send(req.user);
});

app.get("/logout", (req, res) => {
  req.logout();
  res.send("success2")
});

app.get("/multiply", checkAuthenticated, async (req, res) => {
  const thisUser = await User.findById(req.user._id);
  const game_loop = await Game_loop.findById(GAME_LOOP_ID)
  crashMultipler = game_loop.multiplier_crash
  thisUser.balance = (thisUser.balance + crashMultipler)
  await thisUser.save();
  res.json(thisUser);
})

app.get('/generate_crash_value', async (req, res) => {
  const randomInt = Math.floor(Math.random() * 6) + 1
  const game_loop = await Game_loop.findById(GAME_LOOP_ID)
  game_loop.multiplier_crash = randomInt
  await game_loop.save()
  res.json(randomInt)
})

app.get('/retrieve', async (req, res) => {
  const game_loop = await Game_loop.findById(GAME_LOOP_ID)
  crashMultipler = game_loop.multiplier_crash
  res.json(crashMultipler)
  const delta = sw.read(2);
  let seconds = delta / 1000.0;
  seconds = seconds.toFixed(2);
  return
})

app.post('/send_bet', checkAuthenticated, async (req, res) => {
  if (!betting_phase) {
    res.status(400).json({ customError: "IT IS NOT THE BETTING PHASE" });
    return
  }
  if (isNaN(req.body.bet_amount) == true || isNaN(req.body.payout_multiplier) == true) {
    res.status(400).json({ customError: "Not a number" });
  }
  bDuplicate = false
  theLoop = await Game_loop.findById(GAME_LOOP_ID)
  playerIdList = theLoop.active_player_id_list
  let now = Date.now()
  for (var i = 0; i < playerIdList.length; i++) {
    if (playerIdList[i] === req.user.id) {
      res.status(400).json({ customError: "You are already betting this round" });
      bDuplicate = true
      break
    }
  }
  if (bDuplicate) {
    return
  }
  thisUser = await User.findById(req.user.id)
  if (req.body.bet_amount > thisUser.balance) {
    res.status(400).json({ customError: "Bet too big" });
    return
  }
  await User.findByIdAndUpdate(req.user.id, { bet_amount: req.body.bet_amount, payout_multiplier: req.body.payout_multiplier })
  await User.findByIdAndUpdate(req.user.id, { balance: thisUser.balance - req.body.bet_amount })
  await Game_loop.findByIdAndUpdate(GAME_LOOP_ID, { $push: { active_player_id_list: req.user.id } })

  info_json = {
    the_user_id: req.user.id,
    the_username: req.user.username,
    bet_amount: req.body.bet_amount,
    cashout_multiplier: null,
    profit: null,
    b_bet_live: true,
  }
  live_bettors_table.push(info_json)
  io.emit("receive_live_betting_table", JSON.stringify(live_bettors_table))
  res.json(`Bet placed for ${req.user.username}`)
})

app.get('/calculate_winnings', checkAuthenticated, async (req, res) => {
  let theLoop = await Game_loop.findById(GAME_LOOP_ID)
  playerIdList = theLoop.active_player_id_list
  crash_number = theLoop.multiplier_crash
  for (const playerId of playerIdList) {
    const currUser = await User.findById(playerId)
    if (currUser.payout_multiplier <= crash_number) {
      currUser.balance += currUser.bet_amount * currUser.payout_multiplier
      await currUser.save()
    }
  }
  theLoop.active_player_id_list = []
  await theLoop.save()
  res.json("You clicked on the calcualte winnings button ")
})

app.get('/get_game_status', async (req, res) => {
  try {
    let theLoop = await Game_loop.findById(GAME_LOOP_ID);
    if (!theLoop) {
      return res.status(500).json({ error: "Game loop not found" });
    }
    
    io.emit('crash_history', theLoop.previous_crashes)
    io.emit('get_round_id_list', theLoop.round_id_list)
    
    if (betting_phase == true) {
      res.json({ phase: 'betting_phase', info: phase_start_time })
      return
    }
    else if (game_phase == true) {
      res.json({ phase: 'game_phase', info: phase_start_time })
      return
    }
  } catch (err) {
    console.error('Error in get_game_status:', err);
    res.status(500).json({ error: "Internal server error" });
  }
})

// ... [rest of your routes remain the same] ...

// Game Loop Variables
const messages_list = []
let live_bettors_table = []
let betting_phase = false
let game_phase = false
let cashout_phase = true
let game_crash_value = -69
let sent_cashout = true

// Game Loop Functions
const cashout = async () => {
  try {
    const theLoop = await Game_loop.findById(GAME_LOOP_ID);
    if (!theLoop) {
      console.error('Game loop document not found during cashout');
      return;
    }

    const playerIdList = theLoop.active_player_id_list;
    const crash_number = game_crash_value;
    
    for (const playerId of playerIdList) {
      const currUser = await User.findById(playerId);
      if (currUser && currUser.payout_multiplier <= crash_number) {
        currUser.balance += currUser.bet_amount * currUser.payout_multiplier;
        await currUser.save();
      }
    }
    
    theLoop.active_player_id_list = [];
    await theLoop.save();
  } catch (err) {
    console.error('Error in cashout:', err);
  }
}

// Run Game Loop
let phase_start_time = Date.now()
const pat = setInterval(async () => {
  try {
    await loopUpdate()
  } catch (err) {
    console.error('Error in game loop interval:', err);
  }
}, 1000)

// Updated Game Loop with error handling
const loopUpdate = async () => {
  try {
    let theLoop = await Game_loop.findById(GAME_LOOP_ID);
    if (!theLoop) {
      console.error('Game loop document not found');
      return;
    }
    
    let time_elapsed = (Date.now() - phase_start_time) / 1000.0;
    
    if (betting_phase) {
      if (time_elapsed > 6) {
        sent_cashout = false;
        betting_phase = false;
        game_phase = true;
        io.emit('start_multiplier_count');
        phase_start_time = Date.now();
      }
    } else if (game_phase) {
      const current_multiplier = (1.0024 * Math.pow(1.0718, time_elapsed)).toFixed(2);
      if (current_multiplier > game_crash_value) {
        io.emit('stop_multiplier_count', game_crash_value.toFixed(2));
        game_phase = false;
        cashout_phase = true;
        phase_start_time = Date.now();
      }
    } else if (cashout_phase) {
      if (!sent_cashout) {
        await cashout();
        sent_cashout = true;
        
        const update_loop = await Game_loop.findById(GAME_LOOP_ID);
        if (update_loop) {
          await update_loop.updateOne({ $push: { previous_crashes: game_crash_value } });
          await update_loop.updateOne({ $unset: { "previous_crashes.0": 1 } });
          await update_loop.updateOne({ $pull: { "previous_crashes": null } });
          
          const the_round_id_list = update_loop.round_id_list;
          await update_loop.updateOne({ $push: { round_id_list: the_round_id_list[the_round_id_list.length - 1] + 1 } });
          await update_loop.updateOne({ $unset: { "round_id_list.0": 1 } });
          await update_loop.updateOne({ $pull: { "round_id_list": null } });
        }
      }

      if (time_elapsed > 3) {
        cashout_phase = false;
        betting_phase = true;
        let randomInt = Math.floor(Math.random() * (9999999999 - 0 + 1) + 0);
        
        if (randomInt % 33 == 0) {
          game_crash_value = 1;
        } else {
          let random_int_0_to_1 = Math.random();
          while (random_int_0_to_1 == 0) {
            random_int_0_to_1 = Math.random();
          }
          game_crash_value = 0.01 + (0.99 / random_int_0_to_1);
          game_crash_value = Math.round(game_crash_value * 100) / 100;
        }
        
        io.emit('update_user');
        io.emit('crash_history', theLoop.previous_crashes);
        io.emit('get_round_id_list', theLoop.round_id_list);
        io.emit('start_betting_phase');
        io.emit('testingvariable');
        live_bettors_table = [];
        phase_start_time = Date.now();
      }
    }
  } catch (err) {
    console.error('Error in loopUpdate:', err);
  }
}

function checkAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next()
  }
  return res.send("No User Authentication")
}

function checkNotAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return res.redirect('/')
  }
  next()
}

app.listen(4000, () => {
  console.log("Server running on port 4000");
});