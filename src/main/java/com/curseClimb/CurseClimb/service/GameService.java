package com.curseClimb.CurseClimb.service;

import com.curseClimb.CurseClimb.model.GameState;
import com.curseClimb.CurseClimb.model.Player;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * GameService — holds ALL game business logic.
 * The controller stays thin (just maps WebSocket messages → service calls).
 */
@Service
public class GameService {

    private final Map<String, GameState> games = new ConcurrentHashMap<>();
    private final Random    random    = new Random();

    private static final String[] COLORS =
        {"#ff4757","#2ed573","#1e90ff","#ffa502","#ff6b9d"};

    private static final String[] LADDER_GAMES = {
        "MEMORY_MATCH", "QUICK_MATH", "PATTERN_SEQUENCE", "COLOR_CLICK"
    };

    private static final String[] SNAKE_GAMES = {
        "DONT_BLINK", "DARK_MAZE", "MONSTER_CHASE", "CANDLE_SURVIVAL", "SURVIVAL_TIMER"
    };

    private GameState getOrCreateGameState(String gameId) {
        return games.computeIfAbsent(gameId, k -> new GameState());
    }

    // ── New / Reset Game ───────────────────────────────────────────────────────
    public GameState createGame(String gameId, String[] names) {
        GameState gameState = getOrCreateGameState(gameId);
        resetState(gameState);
        for (int i = 0; i < Math.min(names.length, 5); i++) {
            String name = names[i].isBlank() ? "Player " + (i + 1) : names[i].trim();
            Player p = new Player();
            p.setId(UUID.randomUUID().toString());
            p.setName(name);
            p.setColor(COLORS[i]);
            p.setShape("shape-0");
            p.setPosition(1);
            p.setActive(true);
            gameState.getPlayers().add(p);
        }
        gameState.setGameStarted(true);
        gameState.setMessage("⚔️ Game started! " +
            gameState.getPlayers().get(0).getName() + "'s turn! Roll the dice!");
        return gameState;
    }

    // ── Quit ──────────────────────────────────────────────────────────────────
    public GameState quitGame(String gameId) {
        GameState gameState = getOrCreateGameState(gameId);
        resetState(gameState);
        gameState.setMessage("Game ended. Start a new game!");
        return gameState;
    }

    // ── Roll Dice ─────────────────────────────────────────────────────────────
    public GameState rollDice(String gameId, String currentPlayerId) {
        GameState gameState = getOrCreateGameState(gameId);
        if (!gameState.isGameStarted() || gameState.getWinnerName() != null) return gameState;
        if (gameState.getPendingTaskPlayerId() != null) return gameState;

        Player current = gameState.getPlayers().get(gameState.getCurrentTurnIndex());
        if (!current.getId().equals(currentPlayerId)) return gameState;

        int dice = random.nextInt(6) + 1;
        gameState.setLastDiceRoll(dice);

        int remaining = 100 - current.getPosition();
        boolean isSix = (dice == 6);
        boolean stayPut = false;
        int newPos = current.getPosition();

        if (dice > remaining) {
            // Overshoot: do not move!
            stayPut = true;
            gameState.setMessage(current.getName() + " rolled " + dice + ", but needs exactly " + remaining + " to escape! Staying at " + current.getPosition() + ".");
        } else if (dice == remaining) {
            // Win condition: exact roll to 100!
            current.setPosition(100);
            refreshShape(current);
            gameState.setWinnerName(current.getName());
            gameState.setMessage("🏆 " + current.getName() + " ESCAPED THE CURSE CLIMB!");
            return gameState;
        } else {
            // Normal move forward
            newPos = current.getPosition() + dice;
            gameState.setMessage(current.getName() + " rolled " + dice + " → moved to " + newPos + ".");
        }

        // Apply final position if we moved
        if (!stayPut) {
            current.setPosition(newPos);
            refreshShape(current);

            // Check for Snakes / Ladders at the final landing spot
            if (gameState.getSnakes().containsKey(newPos)) {
                int tail = gameState.getSnakes().get(newPos);
                gameState.setPendingTaskPlayerId(current.getId());
                gameState.setPendingTaskType("SNAKE");
                gameState.setPendingTaskGameName(SNAKE_GAMES[random.nextInt(SNAKE_GAMES.length)]);
                gameState.setPendingTaskOriginalPos(newPos);
                gameState.setPendingTaskTargetPos(tail);
                gameState.setMessage(gameState.getMessage() + " 🐍 SNAKE at " + newPos + "! Solve Task to STAY!");
                return gameState;
            }

            if (gameState.getLadders().containsKey(newPos)) {
                int top = gameState.getLadders().get(newPos);
                gameState.setPendingTaskPlayerId(current.getId());
                gameState.setPendingTaskType("LADDER");
                gameState.setPendingTaskGameName(LADDER_GAMES[random.nextInt(LADDER_GAMES.length)]);
                gameState.setPendingTaskOriginalPos(newPos);
                gameState.setPendingTaskTargetPos(top);
                gameState.setMessage(gameState.getMessage() + " 🪜 LADDER at " + newPos + "! Solve Task to CLIMB!");
                return gameState;
            }
        }

        // Turn management
        if (isSix) {
            gameState.setMessage(gameState.getMessage() + " 🎲 Extra turn!");
        } else {
            advanceTurn(gameState);
        }
        return gameState;
    }

    // ── Submit Task Answer ────────────────────────────────────────────────────
    public GameState submitTask(String gameId, String playerId, boolean success, String word) {
        GameState gameState = getOrCreateGameState(gameId);
        if (gameState.getWinnerName() != null) return gameState;
        if (gameState.getPendingTaskPlayerId() == null) return gameState;
        if (!gameState.getPendingTaskPlayerId().equals(playerId)) return gameState;

        Player p = findPlayerById(gameState, playerId);
        if (p == null) return gameState;

        int origin = gameState.getPendingTaskOriginalPos();
        int target = gameState.getPendingTaskTargetPos();
        String type = gameState.getPendingTaskType();

        if ("SNAKE".equals(type)) {
            if (success) {
                String hintFact = getWordHintFact(word);
                gameState.setMessage("Correct! The snake retreats... " + hintFact);
            } else {
                p.setPosition(target);
                refreshShape(p);
                gameState.setMessage("💀 " + p.getName() + " failed! Slid down to " + target + "!");
            }
        } else { // LADDER
            if (success) {
                p.setPosition(target);
                refreshShape(p);
                gameState.setMessage("✅ " + p.getName() + " climbed the ladder to " + target + "!");
            } else {
                int penalty = Math.max(1, origin - 1);
                p.setPosition(penalty);
                refreshShape(p);
                gameState.setMessage("❌ " + p.getName() + " failed and slipped to " + penalty + "!");
            }
        }

        gameState.setPendingTaskPlayerId(null);
        gameState.setPendingTaskType(null);
        gameState.setPendingTaskGameName(null);

        if (p.getPosition() == 100) {
            gameState.setWinnerName(p.getName());
            gameState.setMessage("🏆 " + p.getName() + " ESCAPED THE CURSE CLIMB!");
            return gameState;
        }

        advanceTurn(gameState);
        return gameState;
    }

    // ── Expose read-only state (e.g. for REST endpoint if needed later) ───────
    public GameState getGameState(String gameId) { return getOrCreateGameState(gameId); }

    // ── Private helpers ───────────────────────────────────────────────────────
    private void advanceTurn(GameState gameState) {
        if (!gameState.isGameStarted()) return;
        int next = (gameState.getCurrentTurnIndex() + 1) % gameState.getPlayers().size();
        gameState.setCurrentTurnIndex(next);
        Player np = gameState.getPlayers().get(next);
        gameState.setMessage(gameState.getMessage() + " | 🎯 " + np.getName() + "'s turn!");
    }

    private void refreshShape(Player p) {
        if (p.getPosition() <= 0) return;
        p.setShape("shape-" + Math.min((p.getPosition() - 1) / 10, 9));
    }

    private Player findPlayerById(GameState gameState, String id) {
        return gameState.getPlayers().stream()
            .filter(p -> p.getId().equals(id))
            .findFirst().orElse(null);
    }

    private String getWordHintFact(String word) {
        if (word == null) return "";
        String w = word.trim().toUpperCase();
        switch (w) {
            case "GHOST":
                return "💡 Fact: The belief in ghosts is one of the most widely held paranormal beliefs in the world.";
            case "DOOM":
                return "💡 Hint: Doom represents a state of unavoidable destruction or grim fate.";
            case "GRAVE":
                return "💡 Fact: Ancient cultures buried their dead with treasures and food for the afterlife.";
            case "WITCH":
                return "💡 Fact: In medieval Europe, witches were believed to have magical powers to cast spells.";
            case "CURSE":
                return "💡 Fact: A solemn utterance intended to invoke a supernatural power to inflict harm.";
            case "DEATH":
                return "💡 Fact: In mythology, Death is often personified as the Grim Reaper carrying a large scythe.";
            case "CRYPT":
                return "💡 Fact: A crypt is a stone chamber beneath the floor of a church or tomb.";
            default:
                return "💡 Fact: Spooky spirits linger around the Curse Climb!";
        }
    }

    private void resetState(GameState gameState) {
        gameState.getPlayers().clear();
        gameState.setGameStarted(false);
        gameState.setCurrentTurnIndex(0);
        gameState.setLastDiceRoll(0);
        gameState.setPendingTaskPlayerId(null);
        gameState.setPendingTaskType(null);
        gameState.setPendingTaskOriginalPos(0);
        gameState.setPendingTaskTargetPos(0);
        gameState.setPendingTaskGameName(null);
        gameState.setWinnerName(null);
    }
}
