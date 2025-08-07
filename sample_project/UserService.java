// UserService.java
package com.example.service;

import java.util.List;
import java.util.ArrayList;

public class UserService {
    private List<String> users;
    
    public UserService() {
        this.users = new ArrayList<>();
    }
    
    public void addUser(String username) {
        users.add(username);
    }
    
    public List<String> getAllUsers() {
        return new ArrayList<>(users);
    }
    
    public int getUserCount() {
        return users.size();
    }
    
    public boolean hasUser(String username) {
        return users.contains(username);
    }
}