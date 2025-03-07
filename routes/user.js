const { Router } = require("express");
const mongoose = require("mongoose"); // ✅ Import mongoose

const createTokenForUser = require("../Services/authencation");
const router = Router();
require('dotenv').config();
const jwt = require("jsonwebtoken");




const { checkForAuthencationCookie } = require("../middleware/authencation");

const User = require("../models/user");
const Blog = require("../models/blog");
const Comment = require("../models/comment");



// Profile Edit - GET Form
router.get("/edit", async (req, res) => {
  try {
      const user = await User.findById(req.user._id);
      if (!user) return res.redirect("/user/signin");

      res.render("editprofile", { user });
  } catch (err) {
      console.error(err);
      res.redirect("/user/profile/" + req.user._id);
  }
});

// Profile Edit - POST Update
router.post("/edit", async (req, res) => {
  try {
      const { fullName, email, bio, socials } = req.body;

      await User.findByIdAndUpdate(
          req.user._id,
          {
              fullName,
              email,
              bio,
              socials: {
                 
                  linkedin: socials.linkedin || "",
                  twitter: socials.twitter || "",
                  github: socials.github || "",
                  instagram: socials.instagram || "",
              }
          },
          { new: true, runValidators: true }
      );

      req.flash("success", "Profile updated successfully!");
      res.redirect("/user/profile");
  } catch (error) {
      console.error(error);
      req.flash("error", "Something went wrong!");
      res.redirect("back");
  }
});

//profile
router.get("/profile", async (req, res) => {
  if (!req.cookies.token) {
    return res.status(401).send("No token found, authentication failed.");
  }

  try {
    const decoded = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    const user = await User.findById(decoded._id);
    if (!user) {
      return res.status(404).send("User not found");
    }

    // Ensure ObjectId format
    const userId = new mongoose.Types.ObjectId(user._id);

    // Count total blogs
    const blogCount = await Blog.countDocuments({ createdBy: userId });

    // Get total likes from all blogs created by the user
    const totalLikes = await Blog.aggregate([
      { $match: { createdBy: userId } },
      { $group: { _id: null, total: { $sum: "$likes" } } },
    ]).then((result) => result[0]?.total || 0);

    // 🔥 Get total comments from all blogs created by the user
    const userBlogs = await Blog.find({ createdBy: userId }).select("_id"); // Fetch all blog IDs
    const blogIds = userBlogs.map(blog => blog._id); // Extract IDs into an array

    const totalComments = await Comment.countDocuments({ blogId: { $in: blogIds } });

    // Pass data to EJS
    res.render("profile", { user, blogCount, totalLikes, totalComments ,searchQuery: ""});

  } catch (error) {
    console.error("❌ Error verifying token:", error);
    res.status(500).send("Something went wrong");
  }
});

// Follow a user
router.post("/follow/:userId", async (req, res) => {
  try {
    if (!req.user) {
      req.flash("error", "You must be logged in to follow!");
      return res.redirect("back");
    }

    const userToFollow = await User.findById(req.params.userId);
    const user = await User.findById(req.user._id);

    if (!userToFollow || !user) {
      req.flash("error", "User not found!");
      return res.redirect("back");
    }

    const isFollowing = user.following.includes(userToFollow._id);

    if (isFollowing) {
      // Unfollow
      user.following = user.following.filter(id => id.toString() !== userToFollow._id.toString());
      userToFollow.followers = userToFollow.followers.filter(id => id.toString() !== user._id.toString());
      await user.save();
      await userToFollow.save();
      req.flash("success", `You have unfollowed ${userToFollow.fullName}.`);
    } else {
      // Follow
      user.following.push(userToFollow._id);
      userToFollow.followers.push(user._id);
      await user.save();
      await userToFollow.save();
      req.flash("success", `You are now following ${userToFollow.fullName}!`);
    }

    res.redirect("back");
  } catch (err) {
    console.error("Follow Error:", err);
    req.flash("error", "Something went wrong. Please try again!");
    res.redirect("back");
  }
});

router.get("/signin", (req, res) => {
  return res.render("signin");
});

router.post("/signin", async (req, res) => {
  let { email, passward } = req.body;

  try {
    const token = await User.matchPasswardAndGenerateToken(email, passward);

    // console.log("🟢 Token generated:");

    res.cookie("token", token,{
      httpOnly: true,  
      secure: false,   
      sameSite: "Lax", 
      path: "/",       
      maxAge: 86400 * 1000, 
    });

    // console.log("🟢 Cookie being set:");
    // console.log("🟢 Response headers:", res.getHeaders());    
    return res.redirect("/");
  } catch (error) {
    console.error("❌ Error during sign-in:", error);
    return res.status(401).render("signin", { error: "Invalid Email or Password" });
  }
});

router.get("/signup", (req, res) => {
  return res.render("signup");
});

router.post("/signup", async (req, res) => {
  const { fullName, email, passward } = req.body;

  // Generate a random avatar for the user
  const avatarUrl = `https://api.dicebear.com/8.x/bottts/svg?seed=${encodeURIComponent(email)}`;

  await User.create({
    fullName,
    email,
    passward,
    profilePic: avatarUrl,
  });

  return res.redirect("/");
});

router.get("/logout", (req, res) => {
  return res.clearCookie("token").redirect("/");
});



module.exports = router;
