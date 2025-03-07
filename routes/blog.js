const { Router } = require("express");
const multer = require("multer");
const path = require("path");
const moment = require("moment"); // Ensure moment is imported
const User = require("../models/user");
const Comment = require("../models/comment");
const Blog = require("../models/blog");
const marked = require("marked");
const { checkSubscription } = require("../middleware/subscription");
const { generateBlogWithAI } = require("../utils/aiHelper");



const router = Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.resolve("./public/uploads"));
  },
  filename: function (req, file, cb) {
    const fileName = `${Date.now()}-${file.originalname}`;
    cb(null, fileName);
  },
});

const upload = multer({ storage: storage,
  fileFilter: function (req, file, cb) {
    const filetypes = /jpeg|jpg|png/;
    const limits = { fileSize: 1024 * 1024 * 1 }; 
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    if (mimetype && extname && file.size <= limits.fileSize) {
      return cb(null, true);
    }
    cb("Error: Images Only!");
  },
 });

 // 📝 Create a Blog
router.get("/add-new", (req, res) => {
  return res.render("addBlog", {
    user: req.user || null, // ✅ Prevents crashes if user is undefined
    
    searchQuery: req.query.search || "", // ✅ Prevents EJS errors
  });
});

//
router.get("/:id", async (req, res) => {
  try {
    // Fetch the blog by ID and populate only necessary fields
    const blog = await Blog.findById(req.params.id).populate("createdBy", "fullName profile");

    if (!blog) {
      return res.status(404).render("error", { message: "Blog not found." });
    }

    // Increase the view count and save asynchronously
    blog.views = (blog.views || 0) + 1;
    await blog.save();

    // Fetch comments related to this blog and populate author details
    const comments = await Comment.find({ blogId: req.params.id })
      .populate("createdBy", "fullName profile") // Only fetch needed fields
      .lean() || []; // Use `.lean()` to optimize performance

    // Check if the user is authenticated
    const isAuthenticated = !!req.user;

    return res.render("blog", {
      user: req.user || null,
      blog,
      marked,
      comments,
      searchQuery: "",
      formattedDate: moment(blog.createdAt).format("dddd, MMMM Do YYYY, h:mm A"),
      createdByName: blog.createdBy?.fullName || "Unknown", // ✅ Prevents crashes
      createdByProfilePic: blog.createdBy?.profile || "/default-profile.png", // ✅ Ensures a default image
      isAuthenticated,
      moment,
    });
  } catch (err) {
    console.error("❌ Error fetching blog:", err.message);
    return res.status(500).render("error", { message: "An error occurred while fetching the blog." });
  }
});


// Like or Dislike a Blog Post
router.post("/like/:blogId", async (req, res) => {
  
  try {
      const blog = await Blog.findById(req.params.blogId);
      if (!blog) {
          return res.status(404).json({ success: false, message: "Blog not found" });
      }

      const userId = req.user ? req.user._id.toString() : null;
      if (!userId) {
          return res.status(401).json({ success: false, message: "Unauthorized" });
      }

      const likedIndex = blog.likedBy.indexOf(userId);

      if (likedIndex === -1) {
          blog.likedBy.push(userId);
      } else {
          blog.likedBy.splice(likedIndex, 1);
      }

      blog.likes = blog.likedBy.length;
      await blog.save();

      

      res.json({ success: true, liked: likedIndex === -1, likes: blog.likes }); // ✅ Send the updated likes count
  } catch (error) {
      console.error("Error in liking blog:", error);
      res.status(500).json({ success: false, message: "Server error" });
  }
});

// Comment on a Blog
router.post("/comment/:blogId", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.blogId);
    if (!blog) {
      req.flash("error", "Blog not found.");
      return res.redirect("back");
    }

    await Comment.create({
      content: req.body.content,
      blogId: req.params.blogId,
      createdBy: req.user._id,
    });

    req.flash("success", "Comment added successfully!");
    return res.redirect(`/blog/${req.params.blogId}`);
  } catch (error) {
    console.error("❌ Error adding comment:", error.message);
    req.flash("error", "Something went wrong. Try again.");
    return res.redirect("back");
  }
});

// Category for Blogs
router.get("/category/:category", async (req, res) => {
  const category = req.params.category;
  const blogs = await Blog.find({ category });
  return res.render("home", { user: req.user, blogs });
});

// Tag for Blogs
router.get("/tag/:tag", async (req, res) => {
  const tag = req.params.tag;
  const blogs = await Blog.find({ tags: tag });
  return res.render("home", { user: req.user, blogs });
});

// 🔥 Fetch Featured Blogs
router.get("/featured", async (req, res) => {
  const featuredBlogs = await Blog.find({ featured: true }).limit(3);
  return res.render("home", { user: req.user, blogs: featuredBlogs });
});

// 🚀 Fetch Trending Blogs (Most Viewed)
router.get("/trending", async (req, res) => {
  const trendingBlogs = await Blog.find().sort({ views: -1 }).limit(3);
  return res.render("home", { user: req.user, blogs: trendingBlogs });
});



// 📝 Create a Blog
router.post("/", upload.single("coverImage"), async (req, res) => {
  try {
   
    const { title, body, category, tags, useAI } = req.body;

    if (!req.user) {
      console.log("❌ Unauthorized User");
      return res.status(401).send("Unauthorized: Please log in first.");
    }

    if (!title || !category) {
      console.log("❌ Missing Title or Category");
      return res.status(400).send("Title and Category are required.");
    }

    const tagArray = tags ? tags.split(",").map(tag => tag.trim()) : [];
    if (tagArray.length === 0) {
      console.log("❌ No Tags Provided");
      return res.status(400).send("At least one tag is required.");
    }

    if (!req.file) {
      console.log("❌ No Cover Image Uploaded");
      return res.status(400).send("No cover image uploaded.");
    }

    let finalBody = body?.trim() || "";

    console.log("🤖 AI Requested:", useAI);
    if (useAI === "true" && finalBody.length === 0) {
      console.log("🤖 AI Generating Full Blog...");

      const isSubscribed = await checkSubscription(req.user._id);
      if (!isSubscribed) {
        console.log("❌ User Not Subscribed. Redirecting...");
        return res.redirect("/subscribe");
      }

      try {
        finalBody = await generateBlogWithAI(title, "");
        console.log("✅ AI Generated Full Blog");
      } catch (aiError) {
        console.error("❌ AI Error:", aiError);
        return res.status(500).send("AI failed to generate content. Try again.");
      }
    } else if (useAI === "true") {
      console.log("🤖 AI Expanding Existing Content...");
      try {
        finalBody = await generateBlogWithAI(title, finalBody);
        console.log("✅ AI Expanded Content");
      } catch (aiError) {
        console.error("❌ AI Expansion Error:", aiError);
        return res.status(500).send("AI failed to generate content. Try again.");
      }
    }

    if (!finalBody || finalBody.trim().length === 0) {
      console.log("❌ Final Body Still Empty!");
      return res.status(400).send("Blog content is required.");
    }

    const blog = await Blog.create({
      title,
      body: finalBody,
      category,
      tags: tagArray,
      createdBy: req.user._id,
      coverImageURL: `/uploads/${req.file.filename}`,
    });

   
    return res.redirect("/");
  } catch (error) {
    console.error("❌ Server Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// AI Blog Generation
// router.post("/generate-ai", async (req, res) => {
//   try {
//       const { userId, title, body } = req.body;
      
//       // 🔍 Find the user in the database
//       const user = await User.findById(userId);

//       // 🚨 Check if user is subscribed
//       if (!user || !user.isSubscribed) {
//           return res.status(403).json({ error: "You need a subscription to generate AI blogs." });
//       }

//       // 🎯 AI Blog Generation Logic (Modify API accordingly)
//       const aiResponse = await fetch("YOUR_AI_API_ENDPOINT", {
//           method: "POST",
//           headers: { 
//               "Content-Type": "application/json",
//               "Authorization": `Bearer YOUR_HUGGINGFACE_API_KEY`
//           },
//           body: JSON.stringify({ title, body }),
//       });

//       const data = await aiResponse.json();

//       if (!aiResponse.ok) {
//           return res.status(500).json({ error: "AI generation failed." });
//       }

//       res.json({ generatedContent: data.generatedContent, wordCount: data.wordCount });

//   } catch (error) {
//       console.error("🔥 AI Generation Error:", error);
//       res.status(500).json({ error: "Something went wrong while generating the blog." });
//   }
// });

module.exports = router;