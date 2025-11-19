const dice = {

    audio: new Audio("dice.mp3"),

    playAudio: () => {
        dice.audio.play()
        window.setTimeout(function(){
            dice.audio.pause()
            dice.audio.currentTime = 0
        }, 500);
    },

    area: function() {return document.getElementById('log')},

    rollDice:  (min, max) => min + Math.floor(Math.random() * (max - min + 1)),

    resetView: () => dice.area().innerHTML = '',

    printRoll: (ele) => dice.area().append(ele),

    createDiceElement: (msg, title = false) => {
        diceRoll = document.createElement("p")
        diceRoll.append(msg)
        if (title) {
            diceRoll.title = title
        }
        dice.playAudio()
        dice.printRoll(diceRoll)
    },

    rollDice4: () => dice.createDiceElement("D4: " + dice.rollDice(1, 4)),
    rollDice6: () => dice.createDiceElement("D6: " + dice.rollDice(1, 6)),
    rollDiceDualstaff: () => dice.createDiceElement("Dualstaff - D6 + 3: " + (dice.rollDice(1, 6) + 3)),
    rollDiceDualstaffMelee: () => dice.createDiceElement("Dualstaff D6 + 3 + 2 from dagger: " + (dice.rollDice(1, 6) + 5)),
    rollDice8: () => dice.createDiceElement("D8: " + dice.rollDice(1, 8)),
    rollDice10: () => dice.createDiceElement("D10: " + dice.rollDice(1, 10)),
    rollDice12: () => dice.createDiceElement("D12: " + dice.rollDice(1, 12)),
    rollDiceHopeFear: () => {
        let hope = dice.rollDice(1, 12)
        let fear = dice.rollDice(1, 12)
        console.log(hope)
        console.log(fear)
        let result = (hope >= fear) ? (hope + fear) + " with hope" : (hope + fear) + " with fear"
        let title = 'hope was ' + hope + ', fear was ' + fear
        return dice.createDiceElement(result, title)
    },
    rollDice20: () => dice.createDiceElement("D20: " + dice.rollDice(1, 20)),

    bind: () => {
        document.getElementById("d4").addEventListener('click', function() {dice.rollDice4()});
        document.getElementById("d6").addEventListener('click', function() {dice.rollDice6()});
        document.getElementById("dualstaff").addEventListener('click', function() {dice.rollDiceDualstaff()});
        document.getElementById("dualstaffMelee").addEventListener('click', function() {dice.rollDiceDualstaffMelee()});
        document.getElementById("d8").addEventListener('click', function() {dice.rollDice8()});
        document.getElementById("d10").addEventListener('click', function() {dice.rollDice10()});
        document.getElementById("d12").addEventListener('click', function() {dice.rollDice12()});
        document.getElementById("hopeFear").addEventListener('click', function() {dice.rollDiceHopeFear()});
        document.getElementById("d20").addEventListener('click', function() {dice.rollDice20()});
        document.getElementById("reset").addEventListener('click', function() {dice.resetView()});
        dice.audio.onended = function( ) { this.currentTime = 0; }
    }

};

window.dice = dice;

(function() {
    window.setTimeout(function(){
        window.dice.bind();
    }, 500);
})()

//rollSomeUltimateDice: () => rollDice(42, 42);