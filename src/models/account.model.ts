interface AccountProfile {
  uid: string;          // Firebase Auth ID (Document ID)
  email: string;        // User's email address
  full_name: string;    // User's full name
  createdAt: Date;      // Server timestamp
}

export default AccountProfile;
