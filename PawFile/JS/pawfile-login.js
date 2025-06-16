document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');

  loginForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const userRole = document.getElementById('userRole').value;
    const sponsorId = document.getElementById('sponsorId').value.trim();
    const password = document.getElementById('password').value;

    if (!sponsorId || !password) {
      alert('Please fill in all required fields.');
      return;
    }

    const users = {
      sponsor: [
        { id: 'A7B9K', password: '123' },
        { id: 'M9Z4Q', password: '123' },
        { id: 'F2G3H', password: '123' },
        { id: 'M9Z4Q', password: '123' },
        { id: 'P5R6T', password: '123' },
        { id: 'S1L2E', password: '123' },
        { id: 'V9W0X', password: '123' },
        { id: 'X3D7P', password: '123' },
        { id: 'MZV17', password: '123' },
        { id: 'QAQ97', password: 'f2se0qaw'}
      ],
      admin: [
        { id: 'admin', password: 'adminpass' }
      ]
    };

    // Find user with matching id and password
    const userFound = users[userRole]?.some(user => user.id === sponsorId && user.password === password);

    if (userFound) {
      // Save login status and role in sessionStorage
      sessionStorage.setItem('isLoggedIn', 'true');
      sessionStorage.setItem('userRole', userRole);
      sessionStorage.setItem('userId', sponsorId);

      // Show modal instead of alert
      showLoginSuccessModal(`${capitalize(userRole)} login successful! Redirecting to profile page...`);

      setTimeout(() => {
        window.location.href = '../HTML/sponsor-profile.html';
      }, 1500);
    } else {
      alert('Invalid ID or password.');
    }
  });

  function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Add this function at the end of your file
  function showLoginSuccessModal(message) {
    const modal = document.getElementById('loginSuccessModal');
    const msg = document.getElementById('modalMessage');
    msg.textContent = message;
    modal.style.display = 'flex';
  }
});
