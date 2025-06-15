const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// MySQL connection pool
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root',
  password: 'root@password1',
  database: 'pawfiledb2',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true
});


// Helper to capitalize enum values as needed
function mapEnum(val, type) {
  if (!val) return null;
  if (type === 'yesno') return val.toLowerCase() === 'yes' ? 'Yes' : val.toLowerCase() === 'no' ? 'No' : null;
  if (type === 'color') {
    if (val.toLowerCase() === 'solid') return 'Solid';
    if (val.toLowerCase() === 'bi-color') return 'Bi-color';
    if (val.toLowerCase() === 'multi-color') return 'Multi-color';
  }
  if (type === 'sex') return val.toLowerCase() === 'male' ? 'Male' : val.toLowerCase() === 'female' ? 'Female' : null;
  if (type === 'vaccineType') {
    if (val.toLowerCase() === 'core') return 'Core';
    if (val.toLowerCase() === 'non-core' || val.toLowerCase() === 'noncore') return 'Non-Core';
  }
  return val;
}

// Serve static files
app.use(express.static((__dirname, '..')));

// HTML routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'HTML', 'pawfile-login.html'));
});
app.get('/forms-sponsor-pet.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'HTML', 'forms-sponsor-pet.html'));
});

// ========== /submit-all FORM SUBMISSION ==========
app.post('/submit-all', async (req, res) => {
  const formData = req.body.formData || req.body;
  const password = req.body.password || null;

  if (!formData || !formData.sponsor || !formData.pets || !Array.isArray(formData.pets)) {
    console.error('❌ Invalid data structure:', req.body);
    return res.status(400).json({ success: false, message: 'Invalid data structure.' });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Insert supervisor if provided
    if (formData.sponsor.Supervisor_ID) {
      await connection.query(
        `INSERT IGNORE INTO Supervisor (Supervisor_ID, Supervisor_Name, Supervisor_Email) VALUES (?, ?, ?)`,
        [
          formData.sponsor.Supervisor_ID || null,
          formData.sponsor.Supervisor_Name || null,
          formData.sponsor.Supervisor_Email || null
        ]
      );
    }

    // 2. Insert sponsor (set military fields to NULL if not Active Duty)
    const isActiveDuty = formData.sponsor.Sponsor_Status === 'Active Duty';
    const sponsorValues = [
      formData.sponsor.Sponsor_ID,
      formData.sponsor.Sponsor_LN,
      formData.sponsor.Sponsor_FN,
      formData.sponsor.Sponsor_MI || null,
      formData.sponsor.Spouse_Name || null,
      formData.sponsor.Sponsor_Status,
      isActiveDuty ? formData.sponsor.Grade : null,
      isActiveDuty ? mapEnum(formData.sponsor.is_Dual_Military, 'yesno') : null,
      isActiveDuty ? formData.sponsor.Branch : null,
      isActiveDuty ? formData.sponsor.Unit : null,
      formData.sponsor.Personal_Email,
      formData.sponsor.Mail_Box || null,
      formData.sponsor.Sponsor_Phone_No,
      formData.sponsor.Work_Phone || null,
      formData.sponsor.Spouse_Alt_No || null,
      formData.sponsor.Preferred_Contact,
      formData.sponsor.Supervisor_ID || null,
      password // Temporary_Password
    ];

    await connection.query(
      `INSERT INTO Sponsor (
        Sponsor_ID, Sponsor_LN, Sponsor_FN, Sponsor_MI, Spouse_Name, Sponsor_Status, 
        Grade, is_Dual_Military, Branch, Unit, Personal_Email, Mail_Box, 
        Sponsor_Phone_No, Work_Phone, Spouse_Alt_No, Preferred_Contact, Supervisor_ID
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      sponsorValues.slice(0, 17)
    );

    // 3. Insert pets and their vaccines
    for (const pet of formData.pets) {
      if (!pet.Microchip_No) continue;

      await connection.query(
        `INSERT INTO Pets (
          Microchip_No, Pet_Name, Species, DOB, Age, Breed, 
          Color, Has_Passport, Sex, Is_Spayed_Neutered, 
          Has_Recent_Clinic_History, Clinic_Name, Sponsor_ID
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pet.Microchip_No,
          pet.Pet_Name,
          pet.Species,
          pet.DOB,
          pet.Age,
          pet.Breed,
          mapEnum(pet.Color, 'color'),
          mapEnum(pet.Has_Passport, 'yesno'),
          mapEnum(pet.Sex, 'sex'),
          mapEnum(pet.Is_Spayed_Neutered, 'yesno'),
          mapEnum(pet.Has_Recent_Clinic_History, 'yesno'),
          pet.Clinic_Name || null,
          formData.sponsor.Sponsor_ID
        ]
      );

      // Insert vaccines for this pet
      if (Array.isArray(pet.Vaccines)) {
        for (const vaccine of pet.Vaccines) {
          await connection.query(
            `INSERT IGNORE INTO Vaccine (Vaccine_Lot, Vaccine_Name, Vaccine_Type, Vaccine_Duration) VALUES (?, ?, ?, ?)`,
            [
              vaccine.Vaccine_Lot,
              vaccine.Vaccine_Name,
              mapEnum(vaccine.Vaccine_Type, 'vaccineType'),
              vaccine.Vaccine_Duration
            ]
          );

          await connection.query(
            `INSERT INTO Vaccine_Reaction (
              Sponsor_ID, Microchip_No, Vaccine_Lot, Date_Vaccination, 
              Vaccination_Effectiveness_Until, Has_Vaccine_Reaction, Vaccine_Reaction_Symptoms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              formData.sponsor.Sponsor_ID,
              pet.Microchip_No,
              vaccine.Vaccine_Lot,
              vaccine.Date_Vaccination,
              vaccine.Vaccination_Effectiveness_Until,
              mapEnum(vaccine.Has_Vaccine_Reaction, 'yesno'),
              vaccine.Vaccine_Reaction_Symptoms || null
            ]
          );
        }
      }
    }

    await connection.commit();
    res.status(200).json({
      success: true,
      sponsorId: formData.sponsor.Sponsor_ID,
      password: password
    });
  } catch (error) {
    await connection.rollback();
    console.error('❌ Query error:', error);
    res.status(500).json({
      success: false,
      message: 'Database operation failed',
      error: error.message,
    });
  } finally {
    connection.release();
  }
});



// ========== API ENDPOINTS ========== //

// Get sponsor data along with supervisor info in one call
app.get('/api/sponsor/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [sponsorResults] = await pool.query('SELECT * FROM Sponsor WHERE Sponsor_ID = ?', [id]);
    if (sponsorResults.length === 0) {
      return res.status(404).json({ error: 'Sponsor not found' });
    }
    const sponsor = sponsorResults[0];
    let supervisor = { Supervisor_Name: null, Supervisor_Email: null };
    if (sponsor.Supervisor_ID) {
      const [supervisorResults] = await pool.query(
        'SELECT Supervisor_Name, Supervisor_Email FROM Supervisor WHERE Supervisor_ID = ?',
        [sponsor.Supervisor_ID]
      );
      supervisor = supervisorResults[0] || supervisor;
    }
    res.json({ ...sponsor, ...supervisor });
  } catch (err) {
    console.error('Error fetching sponsor:', err);
    res.status(500).json({ error: 'Database error fetching sponsor' });
  }
});

// Check if a supervisor exists
app.get('/api/supervisor/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const [results] = await pool.query('SELECT * FROM Supervisor WHERE Supervisor_ID = ?', [id]);
    if (results.length === 0) {
      return res.status(404).json({ error: 'Supervisor not found' });
    }
    res.status(200).json(results[0]);
  } catch (err) {
    console.error('Error fetching supervisor:', err);
    res.status(500).json({ error: 'Database error fetching supervisor' });
  }
});

// Get sponsor's pets
app.get('/api/sponsor/:id/pets', async (req, res) => {
  try {
    const sponsorID = req.params.id.toUpperCase();
    const [results] = await pool.query('SELECT * FROM Pets WHERE UPPER(Sponsor_ID) = ?', [sponsorID]);
    const formattedPets = results.map(pet => ({
      id: pet.Microchip_No?.toString(),
      name: pet.Pet_Name,
      sponsor_id: pet.Sponsor_ID
    }));
    res.json(formattedPets);
  } catch (err) {
    console.error('Error fetching pets:', err);
    res.status(500).json({ error: 'Error fetching pets' });
  }
});

// Get pet by microchip
app.get('/api/pet/:microchip', async (req, res) => {
  try {
    const microchip = req.params.microchip;
    const [results] = await pool.query('SELECT * FROM Pets WHERE Microchip_No = ?', [microchip]);
    if (results.length === 0) {
      return res.status(404).json({ error: 'Pet not found' });
    }
    res.json(results[0]);
  } catch (err) {
    console.error('Error fetching pet:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get pet's vaccines
app.get('/api/pet/:microchip/vaccines', async (req, res) => {
  try {
    const microchip = req.params.microchip;
    const [results] = await pool.query(`
      SELECT 
        vr.Vaccine_Lot,
        v.Vaccine_Name,
        v.Vaccine_Type,
        v.Vaccine_Duration,
        vr.Date_Vaccination,
        vr.Vaccination_Effectiveness_Until,
        vr.Has_Vaccine_Reaction,
        vr.Vaccine_Reaction_Symptoms,
        vr.Sponsor_ID
      FROM Vaccine_Reaction vr
      JOIN Vaccine v ON vr.Vaccine_Lot = v.Vaccine_Lot
      WHERE vr.Microchip_No = ?
      ORDER BY vr.Date_Vaccination DESC
    `, [microchip]);
    const formattedResults = results.map(vaccine => ({
      ...vaccine,
      Has_Vaccine_Reaction: vaccine.Has_Vaccine_Reaction === 'Yes' || vaccine.Has_Vaccine_Reaction === 1 ? 'Yes' : 'No',
      Date_Vaccination: vaccine.Date_Vaccination ? new Date(vaccine.Date_Vaccination).toISOString().split('T')[0] : null,
      Vaccination_Effectiveness_Until: vaccine.Vaccination_Effectiveness_Until ? new Date(vaccine.Vaccination_Effectiveness_Until).toISOString().split('T')[0] : null
    }));
    res.json(formattedResults);
  } catch (err) {
    console.error('Error fetching vaccines:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get vaccine by lot
app.get('/api/vaccine/:lot', async (req, res) => {
  try {
    const lot = req.params.lot;
    const [results] = await pool.query('SELECT * FROM Vaccine WHERE Vaccine_Lot = ?', [lot]);
    if (results.length === 0) {
      return res.status(404).json({ error: 'Vaccine not found' });
    }
    res.json({
      exists: true,
      ...results[0]
    });
  } catch (err) {
    console.error('Error fetching vaccine:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST create new vaccine
app.post('/api/vaccines', async (req, res) => {
  const { Vaccine_Lot, Vaccine_Name, Vaccine_Type, Vaccine_Duration } = req.body;
  if (!Vaccine_Lot || !Vaccine_Name || !Vaccine_Type || !Vaccine_Duration) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  try {
    await pool.query(
      'INSERT INTO Vaccine (Vaccine_Lot, Vaccine_Name, Vaccine_Type, Vaccine_Duration) VALUES (?, ?, ?, ?)',
      [Vaccine_Lot, Vaccine_Name, Vaccine_Type, Vaccine_Duration]
    );
    res.status(201).json({ success: true, message: 'Vaccine added successfully' });
  } catch (err) {
    console.error('Error adding vaccine:', err);
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Vaccine lot already exists' });
    }
    res.status(500).json({ error: 'Database error' });
  }
});

// PUT update vaccine reactions
app.put('/api/pets/:petId/vaccine-reactions', async (req, res) => {
  const petId = req.params.petId;
  const { Sponsor_ID, Vaccines } = req.body;
  if (!Sponsor_ID) return res.status(400).json({ error: 'Sponsor_ID is required' });
  if (!Array.isArray(Vaccines)) return res.status(400).json({ error: 'Vaccines must be an array' });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query('DELETE FROM Vaccine_Reaction WHERE Microchip_No = ?', [petId]);
    for (const vaccine of Vaccines) {
      await connection.query(
        `INSERT INTO Vaccine_Reaction 
          (Microchip_No, Sponsor_ID, Vaccine_Lot, Date_Vaccination, Vaccination_Effectiveness_Until, Has_Vaccine_Reaction, Vaccine_Reaction_Symptoms)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          petId,
          Sponsor_ID,
          vaccine.Vaccine_Lot,
          vaccine.Date_Vaccination,
          vaccine.Vaccination_Effectiveness_Until,
          vaccine.Has_Vaccine_Reaction,
          vaccine.Vaccine_Reaction_Symptoms
        ]
      );
    }
    await connection.commit();
    res.json({ success: true, message: 'Vaccine reactions updated successfully' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: 'Failed to update vaccine reactions' });
  } finally {
    connection.release();
  }
});

// Update sponsor data with enhanced supervisor handling
app.put('/api/sponsor/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      Sponsor_FN,
      Sponsor_LN,
      Sponsor_MI,
      Spouse_Name,
      Sponsor_Status,
      Grade,
      is_Dual_Military,
      Branch,
      Unit,
      Personal_Email,
      Mail_Box,
      Sponsor_Phone_No,
      Work_Phone,
      Spouse_Alt_No,
      Preferred_Contact,
      Supervisor_ID
    } = req.body;

    let finalSupervisorId = null;
    let finalGrade = Grade;
    let finalIsDualMilitary = is_Dual_Military;
    let finalBranch = Branch;
    let finalUnit = Unit;

    if (Sponsor_Status === 'ACTIVE DUTY') {
      finalSupervisorId = (!Supervisor_ID || Supervisor_ID.trim() === '') ? null : Supervisor_ID;
    } else {
      finalSupervisorId = null;
      finalGrade = null;
      finalIsDualMilitary = null;
      finalBranch = null;
      finalUnit = null;
    }

    if (finalSupervisorId) {
      const [supResults] = await pool.query('SELECT Supervisor_ID FROM Supervisor WHERE Supervisor_ID = ?', [finalSupervisorId]);
      if (supResults.length === 0) {
        return res.status(400).json({ error: 'Supervisor does not exist' });
      }
    }

    await pool.query(
      `UPDATE Sponsor SET
        Sponsor_FN = ?,
        Sponsor_LN = ?,
        Sponsor_MI = ?,
        Spouse_Name = ?,
        Sponsor_Status = ?,
        Grade = ?,
        is_Dual_Military = ?,
        Branch = ?,
        Unit = ?,
        Personal_Email = ?,
        Mail_Box = ?,
        Sponsor_Phone_No = ?,
        Work_Phone = ?,
        Spouse_Alt_No = ?,
        Preferred_Contact = ?,
        Supervisor_ID = ?
      WHERE Sponsor_ID = ?`,
      [
        Sponsor_FN,
        Sponsor_LN,
        Sponsor_MI,
        Spouse_Name,
        Sponsor_Status,
        finalGrade,
        finalIsDualMilitary,
        finalBranch,
        finalUnit,
        Personal_Email,
        Mail_Box,
        Sponsor_Phone_No,
        Work_Phone,
        Spouse_Alt_No,
        Preferred_Contact,
        finalSupervisorId,
        id
      ]
    );
    res.json({ success: true, message: 'Sponsor updated successfully' });
  } catch (err) {
    console.error('Error updating sponsor:', err);
    res.status(500).json({ error: 'Failed to update sponsor' });
  }
});

// PUT update pet information
app.put('/api/pets/:microchip', async (req, res) => {
  try {
    const microchip = req.params.microchip;
    const { Pet_Name, Sponsor_ID } = req.body;
    await pool.query(
      'UPDATE Pets SET Pet_Name = ?, Sponsor_ID = ? WHERE Microchip_No = ?',
      [Pet_Name, Sponsor_ID, microchip]
    );
    res.json({ success: true, message: 'Pet updated successfully' });
  } catch (err) {
    console.error('Error updating pet:', err);
    res.status(500).json({ error: 'Failed to update pet' });
  }
});

// POST create new pet
app.post('/api/pets', async (req, res) => {
  const { pets, sponsor } = req.body; // pets: array, sponsor: object

  if (!Array.isArray(pets) || !sponsor?.Sponsor_ID) {
    return res.status(400).json({ error: 'Missing pet or sponsor data' });
  }

  const connection = await pool.getConnection();
  try {
    for (const pet of pets) {
      // Insert pet
      await connection.query(
        `INSERT INTO Pets (
          Microchip_No, Pet_Name, Species, DOB, Age, Breed, 
          Color, Has_Passport, Sex, Is_Spayed_Neutered, 
          Has_Recent_Clinic_History, Clinic_Name, Sponsor_ID
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          pet.Microchip_No,
          pet.Pet_Name,
          pet.Species,
          pet.DOB,
          pet.Age,
          pet.Breed,
          mapEnum(pet.Color, 'color'),
          mapEnum(pet.Has_Passport, 'yesno'),
          mapEnum(pet.Sex, 'sex'),
          mapEnum(pet.Is_Spayed_Neutered, 'yesno'),
          mapEnum(pet.Has_Recent_Clinic_History, 'yesno'),
          pet.Clinic_Name || null,
          sponsor.Sponsor_ID
        ]
      );

      // Insert vaccines for this pet
      if (Array.isArray(pet.Vaccines)) {
        for (const vaccine of pet.Vaccines) {
          // Insert vaccine if not exists
          await connection.query(
            `INSERT IGNORE INTO Vaccine (Vaccine_Lot, Vaccine_Name, Vaccine_Type, Vaccine_Duration) VALUES (?, ?, ?, ?)`,
            [
              vaccine.Vaccine_Lot,
              vaccine.Vaccine_Name,
              mapEnum(vaccine.Vaccine_Type, 'vaccineType'),
              vaccine.Vaccine_Duration
            ]
          );

          // Insert vaccine reaction record
          await connection.query(
            `INSERT INTO Vaccine_Reaction (
              Sponsor_ID, Microchip_No, Vaccine_Lot, Date_Vaccination, 
              Vaccination_Effectiveness_Until, Has_Vaccine_Reaction, Vaccine_Reaction_Symptoms
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              sponsor.Sponsor_ID,
              pet.Microchip_No,
              vaccine.Vaccine_Lot,
              vaccine.Date_Vaccination,
              vaccine.Vaccination_Effectiveness_Until,
              mapEnum(vaccine.Has_Vaccine_Reaction, 'yesno'),
              vaccine.Vaccine_Reaction_Symptoms || null
            ]
          );
        }
      }
    }

    res.status(201).json({ message: 'Pets and vaccines added successfully' });
  } catch (error) {
    console.error('Error adding pets and vaccines:', error);
    res.status(500).json({ error: 'Failed to add pets and vaccines' });
  } finally {
    connection.release();
  }
});

// DELETE pet by microchip number
app.delete('/api/pets/:microchip', async (req, res) => {
  const microchip = req.params.microchip;
  const connection = await pool.getConnection();
  try {
    await connection.query('DELETE FROM Pets WHERE Microchip_No = ?', [microchip]);
    res.json({ success: true, message: 'Pet deleted successfully' });
  } catch (err) {
    console.error('Error deleting pet:', err);
    res.status(500).json({ error: 'Failed to delete pet' });
  } finally {
    connection.release();
  }
});

// Delete sponsor account with cascading deletions
app.delete('/api/sponsor/:id', async (req, res) => {
  const sponsorId = req.params.id;
  const connection = await pool.getConnection();
  try {
    const [result] = await connection.query('DELETE FROM Sponsor WHERE Sponsor_ID = ?', [sponsorId]);
    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Sponsor not found' });
    }

    // Respond immediately
    res.json({ message: 'Account deleted successfully' });

    // Cleanup supervisors in the background
    cleanupSupervisors().catch(err => {
      console.error('Cleanup error after deletion:', err);
    });
  } catch (err) {
    connection.release();
    console.error('Error deleting sponsor:', err);
    res.status(500).json({ error: 'Error deleting sponsor account' });
  }
});

// Cleanup supervisors function
async function cleanupSupervisors() {
  try {
    // Step 1: Remove supervisor_id from sponsors who are not on active duty
    await pool.query(`
      UPDATE Sponsor 
      SET Supervisor_ID = NULL 
      WHERE Sponsor_Status != 'ACTIVE DUTY' AND Supervisor_ID IS NOT NULL
    `);

    // Step 2: Find supervisors who are no longer supervising anyone
    const [orphanedSupervisors] = await pool.query(`
      SELECT s.Supervisor_ID 
      FROM Supervisor s
      LEFT JOIN Sponsor sp ON s.Supervisor_ID = sp.Supervisor_ID
      WHERE sp.Supervisor_ID IS NULL
    `);

    // Step 3: Delete orphaned supervisors
    if (orphanedSupervisors.length > 0) {
      const ids = orphanedSupervisors.map(s => s.Supervisor_ID);
      await pool.query('DELETE FROM Supervisor WHERE Supervisor_ID IN (?)', [ids]);
    }
  } catch (err) {
    console.error('Error cleaning up supervisors:', err);
  }
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});