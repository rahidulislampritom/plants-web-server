require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')

const port = process.env.PORT || 9000
const app = express()
// middleware
const corsOptions = {
  origin: ['http://localhost:5173', 'http://localhost:5174'],
  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.v3edin0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {

    const db = client.db('plantNet-session');
    const userCollection = db.collection('users');
    const plantsCollection = db.collection('plants');
    const orderCollection = db.collection('Orders');


    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    });


    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    });


    // this post for set users info in db userCollection from (AuthProvider.jsx)
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const isExit = await userCollection.findOne(query);
      if (isExit) {
        return res.send(isExit);
      }
      const result = await userCollection.insertOne(
        {
          ...user,
          timestamp: Date.now(),
          role: 'customer'
        }
      );
      res.send(result);
    });


    // this post for setting add plant data to data base from (AddPlants.jsx)
    app.post('/plants', verifyToken, async (req, res) => {
      const data = req.body;
      const result = await plantsCollection.insertOne(data)
      res.send(result);
    })


    // this get operation doing for show plants data in (Plants.jsx) 
    app.get('/plants', async (req, res) => {
      const result = await plantsCollection.find().toArray();
      res.send(result)
    });


    // this get operation is getting plantDetails by id in (PlantDetails.jsx) 
    app.get('/plantDetails/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await plantsCollection.findOne(query);
      res.send(result);
    });


    // this post is posting order plants data from (PurchaseModal.jsx )
    app.post('/order', verifyToken, async (req, res) => {
      const data = req.body;
      const result = await orderCollection.insertOne(data)
      res.send(result)
    });


    // this patch is updating the plantsCollection quantity in db from (PurchaseModal.jsx) and (CustomerOrderDataRow.jsx)
    app.patch('/plants/quantity/:id', async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      console.log(quantityToUpdate, status)
      const filter = { _id: new ObjectId(id) };

      let updateDoc = {
        $inc: { quantity: -quantityToUpdate },
      };

      if (status === 'increase') {
        updateDoc = {
          $inc: { quantity: quantityToUpdate },
        }
      }
      const result = await plantsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });


    // this get operation is getting order data maching by email in (MyOrder.jsx)
    app.get('/customer-orders/:email', async (req, res) => {
      const email = req.params?.email;
      const query = { 'customer.email': email }
      const result = await orderCollection.aggregate([

        {
          $match: query
        },
        {
          $addFields: {
            plantId: { $toObjectId: '$plantId' }
          }
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plants'
          },
        },
        {
          $unwind: '$plants'
        },
        {
          $addFields: {
            name: '$plants.name',
            image: '$plants.image',
            category: '$plants.category'
          }
        },
        {
          $project: {
            plants: 0
          }
        }

      ]).toArray();
      res.send(result);
    });


    // this is delete operation deleting order data clicking in cancel from (CustomerOrderDataRow.jsx) 
    app.delete('/orders/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const order = await orderCollection.findOne(query);

      if (order.status === 'Delivered') {
        return res.status(409).send('Cannot cancel once the product is delivered!')
      }

      const result = await orderCollection.deleteOne(query);
      res.send(result);
    });


    // manage user status db in from (customerMenu.jsx)
    app.patch('/users/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (!user || user?.status === 'Requested') return res.status(400).send('You have already requested,wait for some time.');

      const updateDoc = {
        $set: {
          status: 'Requested'
        }
      };

      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });


    // this get operation for getting role of user from usersDB using hook name (useRole.jsx)
    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const result = await userCollection.findOne(query);
      res.send({ role: result?.role })
    });

    // this get operation is getting data of users without admin from (ManageUsers.jsx)
    app.get('/allUsers/:email', async (req, res) => {
      const email = req.params.email;
      const query = { email: { $ne: email } };
      const result = await userCollection.find(query).toArray();
      res.send(result);
    })



    // Send a ping to confirm a successful connection 
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from plantNet Server..')
})

app.listen(port, () => {
  console.log(`plantNet is running on port ${port}`)
})
