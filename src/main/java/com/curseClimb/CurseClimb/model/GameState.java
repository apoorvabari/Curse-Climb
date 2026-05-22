package com.curseClimb.CurseClimb.model;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class GameState {
    private List<Player> players = new ArrayList<>();
    private int currentTurnIndex = 0;
    private boolean gameStarted = false;
    private String message = "Waiting for players...";
    private String winnerName = null;
    
    // For pending tasks
    private String pendingTaskPlayerId = null;
    private String pendingTaskType = null; // "SNAKE" or "LADDER"
    private String pendingTaskGameName = null; // e.g. "MEMORY_MATCH", "QUICK_MATH"
    private int pendingTaskOriginalPos = 0; // position before task
    private int pendingTaskTargetPos = 0; // tail for snake, top for ladder

    // Board Configuration
    private final Map<Integer, Integer> snakes = new HashMap<>();
    private final Map<Integer, Integer> ladders = new HashMap<>();

    private int lastDiceRoll = 0;

    public GameState() {
        // Snakes
        snakes.put(16, 6);
        snakes.put(47, 26);
        snakes.put(49, 11);
        snakes.put(56, 53);
        snakes.put(62, 19);
        snakes.put(64, 60);
        snakes.put(87, 24);
        snakes.put(93, 73);
        snakes.put(95, 75);
        snakes.put(98, 78);

        // Ladders
        ladders.put(2, 38);
        ladders.put(4, 14);
        ladders.put(9, 31);
        ladders.put(21, 42);
        ladders.put(28, 84);
        ladders.put(36, 44);
        ladders.put(51, 67);
        ladders.put(71, 91);
        ladders.put(80, 100);
    }

    // Standard Getters and Setters
    public List<Player> getPlayers() {
        return players;
    }

    public void setPlayers(List<Player> players) {
        this.players = players;
    }

    public int getCurrentTurnIndex() {
        return currentTurnIndex;
    }

    public void setCurrentTurnIndex(int currentTurnIndex) {
        this.currentTurnIndex = currentTurnIndex;
    }

    public boolean isGameStarted() {
        return gameStarted;
    }

    public void setGameStarted(boolean gameStarted) {
        this.gameStarted = gameStarted;
    }

    public String getMessage() {
        return message;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    public String getPendingTaskPlayerId() {
        return pendingTaskPlayerId;
    }

    public void setPendingTaskPlayerId(String pendingTaskPlayerId) {
        this.pendingTaskPlayerId = pendingTaskPlayerId;
    }

    public String getPendingTaskType() {
        return pendingTaskType;
    }

    public void setPendingTaskType(String pendingTaskType) {
        this.pendingTaskType = pendingTaskType;
    }

    public int getPendingTaskOriginalPos() {
        return pendingTaskOriginalPos;
    }

    public void setPendingTaskOriginalPos(int pendingTaskOriginalPos) {
        this.pendingTaskOriginalPos = pendingTaskOriginalPos;
    }

    public int getPendingTaskTargetPos() {
        return pendingTaskTargetPos;
    }

    public void setPendingTaskTargetPos(int pendingTaskTargetPos) {
        this.pendingTaskTargetPos = pendingTaskTargetPos;
    }

    public Map<Integer, Integer> getSnakes() {
        return snakes;
    }

    public Map<Integer, Integer> getLadders() {
        return ladders;
    }

    public int getLastDiceRoll() {
        return lastDiceRoll;
    }

    public void setLastDiceRoll(int lastDiceRoll) {
        this.lastDiceRoll = lastDiceRoll;
    }

    public String getWinnerName() {
        return winnerName;
    }

    public void setWinnerName(String winnerName) {
        this.winnerName = winnerName;
    }

    public String getPendingTaskGameName() {
        return pendingTaskGameName;
    }

    public void setPendingTaskGameName(String pendingTaskGameName) {
        this.pendingTaskGameName = pendingTaskGameName;
    }
}
