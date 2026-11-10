/* Pricing Laboratory: the lab-book sections, shared by the class page (pricing.js) and the instructor page
   (pricing_instructor.js). Pins are filed under the question TITLE (psectionOf); answers under the id. */
var PQUESTIONS = [
  { id: "c1", tab: "challenge", title: "1. Your flights",
    prompt: "After the reveal. Which of your fares earned the most, and how far was it from the best fare? What did your first test flight cost you, and what did it tell you about the demand? Looking at the profit curve, how much does it cost to be £50 off the best fare, and how much to fill the plane? What would you do with six more flights?" },
  { id: "c2", tab: "challenge", title: "2. Demand rises 40%",
    prompt: "Round 2, first scenario: at every fare, 40% more people want to fly than in round 1. Before you test anything, write down your guess for the best fare. Then test fares and pin the one you recommend. Does the best fare change? Explain why, in terms of what a lower fare costs on the passengers you already carry and what it earns on the new ones." },
  { id: "c3", tab: "challenge", title: "3. Demand doubles",
    prompt: "Round 2, second scenario: demand doubles. Test fares and pin the one you recommend. What limits you now that did not before, and how does the best fare compare with the first scenario? At that fare, how many people would like to fly and cannot? What would you expect to see outside the airport?" },
  { id: "m1", tab: "mocha", title: "4. Price Mocha for your stream",
    prompt: "The bids are the most each student in your stream said they would pay for Mocha in Session 1. With a cost of £15 per Mocha, find the price that earns the most and pin it. How many of your classmates buy at that price, and what share of the stream is that? Why is the best price not the price that sells the most, and not the median bid?" },
  { id: "m2", tab: "mocha", title: "5. The straight line",
    prompt: "Show the fitted line. It turns the bids into a demand line P = a − bQ, and MR = MC on that line gives a price. How far is that price from the best price on the raw bids, and how much profit does it give up? Pin it. What is it about your classmates' bids that the line does not see? When would you trust the line more than the raw bids?" },
  { id: "m3", tab: "mocha", title: "6. Do you believe the bids at £50?",
    prompt: "Bids were capped at £50, and several students bid exactly that. Ignore bids above £49 and price again; then put them back and ignore the £0 bids instead. Pin both. Which bids would you trust when setting a real price, and what price would you actually charge?" },
  { id: "m4", tab: "mocha", title: "7. Three streams, three prices",
    prompt: "Open Three streams. If you could charge each stream its own price, how much more would you earn than with one price for all, in pounds and in percent? Why is the gain the size it is? Add last year's bids as a fourth market and look again: what changes, and why?" },
  { id: "own", title: "Your own experiments",
    prompt: "Anything you tried beyond the questions above. Give each column a clear label when you pin it, and write here what you learned from it." }];
function psectionOf(entry) { for (var i = 0; i < PQUESTIONS.length; i++) if (PQUESTIONS[i].title === entry.question) return PQUESTIONS[i].id; return "own"; }
if (typeof module !== "undefined" && module.exports) module.exports = { PQUESTIONS: PQUESTIONS, psectionOf: psectionOf };
